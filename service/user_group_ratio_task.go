package service

import (
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/bytedance/gopkg/util/gopool"
)

var personalGroupRatioTaskOnce sync.Once

func StartPersonalGroupRatioTask() {
	personalGroupRatioTaskOnce.Do(func() {
		if !common.IsMasterNode {
			return
		}
		gopool.Go(func() {
			ticker := time.NewTicker(time.Minute)
			defer ticker.Stop()
			for {
				if err := model.CheckPersonalGroupRatios(time.Now()); err != nil {
					common.SysError(common.LogText("Personal group ratio daily check failed: %s", err.Error()))
				}
				<-ticker.C
			}
		})
	})
}
