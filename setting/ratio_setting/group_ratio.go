package ratio_setting

import (
	"encoding/json"
	"errors"
	"math"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/config"
	"github.com/QuantumNous/new-api/types"
)

var defaultGroupRatio = map[string]float64{
	"default": 1,
	"vip":     1,
	"svip":    1,
}

var groupRatioMap = types.NewRWMap[string, float64]()

const (
	GroupGroupRatioOptionKey = "GroupGroupRatio"
	GroupGroupRatioConfigKey = "group_ratio_setting.group_group_ratio"
	MaxGroupSpecialRatio     = 1<<53 - 1
	MaxGroupRatioTimestamp   = 253402300799
)

var (
	ErrGroupSpecialRatioStructure = common.NewMessage("Special multiplier rules must be numbers or objects with ratio, enabled, starts_at, and ends_at")
	ErrGroupSpecialRatioValue     = common.NewMessage("Special multipliers must be finite numbers between 0 and 9007199254740991")
	ErrGroupSpecialRatioTime      = common.NewMessage("Special multiplier times must be whole Unix seconds between 0 and 253402300799")
	ErrGroupSpecialRatioPeriod    = common.NewMessage("Special multiplier end time must be later than its start time")
)

// GroupSpecialRatioRule preserves legacy numeric leaves when exporting settings.
type GroupSpecialRatioRule struct {
	Ratio    float64 `json:"ratio"`
	Enabled  bool    `json:"enabled"`
	StartsAt int64   `json:"starts_at"`
	EndsAt   int64   `json:"ends_at"`
	legacy   bool
}

func (r GroupSpecialRatioRule) MarshalJSON() ([]byte, error) {
	if r.legacy {
		return common.Marshal(r.Ratio)
	}
	type ruleJSON GroupSpecialRatioRule
	return common.Marshal(ruleJSON(r))
}

func (r *GroupSpecialRatioRule) UnmarshalJSON(data []byte) error {
	var rule GroupSpecialRatioRule
	switch common.GetJsonType(data) {
	case "number":
		if err := common.Unmarshal(data, &rule.Ratio); err != nil {
			return ErrGroupSpecialRatioValue
		}
		rule.Enabled, rule.legacy = true, true
	case "object":
		var fields map[string]json.RawMessage
		if err := common.Unmarshal(data, &fields); err != nil || len(fields) != 4 {
			return ErrGroupSpecialRatioStructure
		}
		for _, key := range []string{"ratio", "enabled", "starts_at", "ends_at"} {
			if _, ok := fields[key]; !ok {
				return ErrGroupSpecialRatioStructure
			}
		}
		if common.GetJsonType(fields["ratio"]) != "number" || common.Unmarshal(fields["ratio"], &rule.Ratio) != nil {
			return ErrGroupSpecialRatioValue
		}
		if common.GetJsonType(fields["enabled"]) != "boolean" || common.Unmarshal(fields["enabled"], &rule.Enabled) != nil {
			return ErrGroupSpecialRatioStructure
		}
		if common.GetJsonType(fields["starts_at"]) != "number" || common.GetJsonType(fields["ends_at"]) != "number" ||
			common.Unmarshal(fields["starts_at"], &rule.StartsAt) != nil || common.Unmarshal(fields["ends_at"], &rule.EndsAt) != nil {
			return ErrGroupSpecialRatioTime
		}
	default:
		return ErrGroupSpecialRatioStructure
	}
	if math.IsNaN(rule.Ratio) || math.IsInf(rule.Ratio, 0) || rule.Ratio < 0 || rule.Ratio > MaxGroupSpecialRatio {
		return ErrGroupSpecialRatioValue
	}
	if rule.StartsAt < 0 || rule.EndsAt < 0 || rule.StartsAt > MaxGroupRatioTimestamp || rule.EndsAt > MaxGroupRatioTimestamp {
		return ErrGroupSpecialRatioTime
	}
	if rule.EndsAt != 0 && rule.EndsAt <= rule.StartsAt {
		return ErrGroupSpecialRatioPeriod
	}
	*r = rule
	return nil
}

func (r GroupSpecialRatioRule) activeAt(at time.Time) bool {
	second := at.Unix()
	return r.Enabled && (r.StartsAt == 0 || second >= r.StartsAt) && (r.EndsAt == 0 || second < r.EndsAt)
}

type groupSpecialRatioState struct {
	mutex sync.RWMutex
	rules map[string]map[string]GroupSpecialRatioRule
}

// A value field prevents ConfigManager's pointer/null shortcut from bypassing
// validation. Copies share the same state; invalid JSON never replaces it.
type GroupSpecialRatioRules struct {
	state *groupSpecialRatioState
}

func (r GroupSpecialRatioRules) MarshalJSON() ([]byte, error) {
	if r.state == nil {
		return []byte("{}"), nil
	}
	r.state.mutex.RLock()
	defer r.state.mutex.RUnlock()
	return common.Marshal(r.state.rules)
}

func (r *GroupSpecialRatioRules) UnmarshalJSON(data []byte) error {
	rules, err := parseGroupSpecialRatioRules(data)
	if err != nil {
		return err
	}
	if r.state == nil {
		r.state = &groupSpecialRatioState{}
	}
	r.state.mutex.Lock()
	defer r.state.mutex.Unlock()
	r.state.rules = rules
	return nil
}

func parseGroupSpecialRatioRules(data []byte) (map[string]map[string]GroupSpecialRatioRule, error) {
	if common.GetJsonType(data) != "object" {
		return nil, ErrGroupSpecialRatioStructure
	}
	var rules map[string]map[string]GroupSpecialRatioRule
	if err := common.Unmarshal(data, &rules); err != nil {
		var message *common.Message
		if errors.As(err, &message) {
			return nil, message
		}
		return nil, ErrGroupSpecialRatioStructure
	}
	for _, groups := range rules {
		if groups == nil {
			return nil, ErrGroupSpecialRatioStructure
		}
	}
	return rules, nil
}

func IsGroupGroupRatioOption(key string) bool {
	return key == GroupGroupRatioOptionKey || key == GroupGroupRatioConfigKey
}

func ValidateGroupGroupRatioJSON(value string) error {
	_, err := parseGroupSpecialRatioRules([]byte(value))
	return err
}

var defaultGroupGroupRatio = map[string]map[string]GroupSpecialRatioRule{
	"vip": {
		"edit_this": {Ratio: 0.9, Enabled: true, legacy: true},
	},
}

var groupGroupRatioMap = GroupSpecialRatioRules{state: &groupSpecialRatioState{rules: defaultGroupGroupRatio}}

var defaultGroupSpecialUsableGroup = map[string]map[string]string{}

type GroupRatioSetting struct {
	GroupRatio              *types.RWMap[string, float64]           `json:"group_ratio"`
	GroupGroupRatio         GroupSpecialRatioRules                  `json:"group_group_ratio"`
	GroupSpecialUsableGroup *types.RWMap[string, map[string]string] `json:"group_special_usable_group"`
}

var groupRatioSetting GroupRatioSetting

func init() {
	groupSpecialUsableGroup := types.NewRWMap[string, map[string]string]()
	groupSpecialUsableGroup.AddAll(defaultGroupSpecialUsableGroup)

	groupRatioMap.AddAll(defaultGroupRatio)

	groupRatioSetting = GroupRatioSetting{
		GroupSpecialUsableGroup: groupSpecialUsableGroup,
		GroupRatio:              groupRatioMap,
		GroupGroupRatio:         groupGroupRatioMap,
	}

	config.GlobalConfig.Register("group_ratio_setting", &groupRatioSetting)
}

func GetGroupRatioSetting() *GroupRatioSetting {
	if groupRatioSetting.GroupSpecialUsableGroup == nil {
		groupRatioSetting.GroupSpecialUsableGroup = types.NewRWMap[string, map[string]string]()
		groupRatioSetting.GroupSpecialUsableGroup.AddAll(defaultGroupSpecialUsableGroup)
	}
	return &groupRatioSetting
}

func GetGroupRatioCopy() map[string]float64 {
	return groupRatioMap.ReadAll()
}

func ContainsGroupRatio(name string) bool {
	_, ok := groupRatioMap.Get(name)
	return ok
}

func GroupRatio2JSONString() string {
	return groupRatioMap.MarshalJSONString()
}

func UpdateGroupRatioByJSONString(jsonStr string) error {
	return types.LoadFromJsonString(groupRatioMap, jsonStr)
}

func GetGroupRatio(name string) float64 {
	ratio, ok := groupRatioMap.Get(name)
	if !ok {
		common.SysLog(common.LogText("group ratio not found: %s", name))
		return 1
	}
	return ratio
}

func GetGroupGroupRatio(userGroup, usingGroup string) (float64, bool) {
	return GetGroupGroupRatioAt(userGroup, usingGroup, time.Now())
}

func GetGroupGroupRatioAt(userGroup, usingGroup string, at time.Time) (float64, bool) {
	groupGroupRatioMap.state.mutex.RLock()
	defer groupGroupRatioMap.state.mutex.RUnlock()
	rule, ok := groupGroupRatioMap.state.rules[userGroup][usingGroup]
	if !ok || !rule.activeAt(at) {
		return -1, false
	}
	return rule.Ratio, true
}

// GetGroupGroupRatiosAt returns an independent snapshot for request retries.
func GetGroupGroupRatiosAt(userGroup string, at time.Time) map[string]float64 {
	groupGroupRatioMap.state.mutex.RLock()
	defer groupGroupRatioMap.state.mutex.RUnlock()
	ratios := make(map[string]float64)
	for group, rule := range groupGroupRatioMap.state.rules[userGroup] {
		if rule.activeAt(at) {
			ratios[group] = rule.Ratio
		}
	}
	return ratios
}

func GroupGroupRatio2JSONString() string {
	encoded, err := groupGroupRatioMap.MarshalJSON()
	if err != nil {
		return "{}"
	}
	return string(encoded)
}

func UpdateGroupGroupRatioByJSONString(jsonStr string) error {
	return groupGroupRatioMap.UnmarshalJSON([]byte(jsonStr))
}

func CheckGroupRatio(jsonStr string) error {
	checkGroupRatio := make(map[string]float64)
	err := common.Unmarshal([]byte(jsonStr), &checkGroupRatio)
	if err != nil {
		return err
	}
	for name, ratio := range checkGroupRatio {
		if ratio < 0 {
			return errors.New("group ratio must be not less than 0: " + name)
		}
	}
	return nil
}
