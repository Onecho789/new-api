package service

import (
	"fmt"
	"slices"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
)

// PreparePersonalGroupSpendGuard makes an unfinished discounted request visible
// to the daily evaluator before any money moves. It contains no request content.
func PreparePersonalGroupSpendGuard(info *relaycommon.RelayInfo) error {
	if info == nil || info.PersonalGroupRatio == nil {
		return nil
	}
	if info.PersonalSpendID == "" {
		info.PersonalSpendID = common.NewRequestId()
	}
	snapshot := info.PersonalGroupRatio
	key := fmt.Sprintf("personal:%s:guard:%d:%d", info.PersonalSpendID, snapshot.RuleID, snapshot.Version)
	if slices.Contains(info.PersonalSpendGuardKeys, key) {
		return nil
	}
	if err := model.BeginPersonalGroupSpendGuard(key, snapshot, time.Now()); err != nil {
		return err
	}
	info.PersonalSpendGuardKeys = append(info.PersonalSpendGuardKeys, key)
	return nil
}

func beginPersonalGroupSpend(info *relaycommon.RelayInfo, quota int) error {
	if err := PreparePersonalGroupSpendGuard(info); err != nil {
		return err
	}
	if info.PersonalGroupRatio == nil || info.PersonalSpendDeferred {
		return nil
	}
	key := "personal:" + info.PersonalSpendID + ":final"
	if err := model.BeginPersonalGroupSpendIntent(key, info.PersonalGroupRatio, quota, time.Now()); err != nil {
		return err
	}
	info.PersonalSpendFinalKey = key
	return nil
}

func completePersonalGroupSpend(info *relaycommon.RelayInfo) error {
	if info.PersonalSpendDeferred {
		return nil
	}
	if info.PersonalSpendFinalKey != "" {
		if err := model.CompletePersonalGroupSpendIntent(info.PersonalSpendFinalKey); err != nil {
			return err
		}
	}
	return cancelPersonalGroupSpendGuards(info.PersonalSpendGuardKeys)
}

func cancelPersonalGroupSpendGuards(keys []string) error {
	for _, key := range keys {
		if err := model.CancelPersonalGroupSpendIntent(key); err != nil {
			return err
		}
	}
	return nil
}

func cancelPersonalGroupSpend(info *relaycommon.RelayInfo) error {
	if info.PersonalSpendFinalKey != "" {
		if err := model.CancelPersonalGroupSpendIntent(info.PersonalSpendFinalKey); err != nil {
			return err
		}
	}
	return cancelPersonalGroupSpendGuards(info.PersonalSpendGuardKeys)
}

func beginPersonalTaskSpend(task *model.Task, quota int) error {
	bc := task.PrivateData.BillingContext
	if bc == nil || bc.PersonalGroupRatio == nil {
		return nil
	}
	if !bc.PersonalFundingApplied {
		return fmt.Errorf("personal task funding is not confirmed")
	}
	return model.BeginPersonalGroupSpendIntent("personal:"+bc.PersonalSpendID+":final", bc.PersonalGroupRatio, quota, time.Now())
}

// CompletePersonalTaskSpend is called only after funding and durable task state
// agree. Failures intentionally leave the guard pending for reconciliation.
func CompletePersonalTaskSpend(task *model.Task) error {
	bc := task.PrivateData.BillingContext
	if bc == nil {
		return nil
	}
	if (bc.PersonalGroupRatio != nil || len(bc.PersonalSpendGuardKeys) > 0) && !bc.PersonalFundingApplied {
		return fmt.Errorf("personal task funding is not confirmed")
	}
	if bc.PersonalGroupRatio != nil {
		if err := model.CompletePersonalGroupSpendIntent("personal:" + bc.PersonalSpendID + ":final"); err != nil {
			return err
		}
	}
	return cancelPersonalGroupSpendGuards(bc.PersonalSpendGuardKeys)
}

// FinalizePersonalTaskSpend also handles fixed-price tasks with no final delta.
func FinalizePersonalTaskSpend(task *model.Task) error {
	if err := beginPersonalTaskSpend(task, task.Quota); err != nil {
		return err
	}
	return CompletePersonalTaskSpend(task)
}
