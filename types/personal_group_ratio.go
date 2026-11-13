package types

// PersonalGroupRatioSnapshot fixes the policy used by an in-flight request.
// It is persisted with asynchronous tasks so later policy changes cannot reprice them.
type PersonalGroupRatioSnapshot struct {
	RuleID   int     `json:"rule_id"`
	UserID   int     `json:"user_id"`
	Group    string  `json:"group"`
	Version  int64   `json:"version"`
	Ratio    float64 `json:"ratio"`
	PricedAt int64   `json:"priced_at,omitempty"`
}
