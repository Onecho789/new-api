package common

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/setting/model_setting"
	"github.com/QuantumNous/new-api/setting/system_setting"

	"github.com/gin-gonic/gin"
)

// SystemPromptInjection 描述本次请求需要写入系统提示词位置的文本。
//
// 网关有两层系统提示词：全局安全提示词（system_setting.SafetyPromptSettings）和
// 渠道级系统提示词（ChannelSettings.SystemPrompt）。两者的注入条件不同：
//
//   - 安全提示词一旦开启就必须注入，否则客户端只要自带 system 消息就能绕过；
//   - 渠道级提示词沿用既有语义，客户端已有系统提示词时只在 SystemPromptOverride
//     打开的情况下才拼接。
//
// 最终顺序始终是 安全提示词 -> 渠道提示词 -> 客户端原有内容。
type SystemPromptInjection struct {
	safety        string
	channelPrompt string
	channelMerges bool
}

// ResolveSystemPromptInjection 计算本次请求两层系统提示词的注入内容。
//
// 透传模式下上游收到的是客户端原始请求体，网关对请求结构的改写不会生效，
// 因此这里直接返回空注入：既避免做无效改写，也避免在日志中留下错误的注入标记。
func ResolveSystemPromptInjection(info *RelayInfo) SystemPromptInjection {
	if info != nil && info.ChannelMeta != nil && info.ChannelSetting.PassThroughBodyEnabled {
		return SystemPromptInjection{}
	}
	if model_setting.GetGlobalSettings().PassThroughRequestEnabled {
		return SystemPromptInjection{}
	}
	injection := SystemPromptInjection{safety: system_setting.GetEnabledSafetyPrompt()}
	if info != nil && info.ChannelMeta != nil {
		injection.channelPrompt = info.ChannelSetting.SystemPrompt
		injection.channelMerges = info.ChannelSetting.SystemPromptOverride
	}
	return injection
}

// BuildStandalone 返回客户端未携带系统提示词时应整体写入的文本，无内容时返回空串。
func (i SystemPromptInjection) BuildStandalone(c *gin.Context) string {
	text := joinSystemPrompts(i.safety, i.channelPrompt)
	if text == "" {
		return ""
	}
	i.markSafetyInjected(c)
	return text
}

// BuildPrefix 返回需要拼接到客户端已有系统提示词之前的文本，无内容时返回空串。
func (i SystemPromptInjection) BuildPrefix(c *gin.Context) string {
	channelPrompt := ""
	if i.channelMerges {
		channelPrompt = i.channelPrompt
	}
	text := joinSystemPrompts(i.safety, channelPrompt)
	if text == "" {
		return ""
	}
	i.markSafetyInjected(c)
	if channelPrompt != "" {
		common.SetContextKey(c, constant.ContextKeySystemPromptOverride, true)
	}
	return text
}

func (i SystemPromptInjection) markSafetyInjected(c *gin.Context) {
	if i.safety != "" {
		common.SetContextKey(c, constant.ContextKeySafetyPromptInjected, true)
	}
}

func joinSystemPrompts(safety string, channelPrompt string) string {
	switch {
	case safety == "":
		return channelPrompt
	case channelPrompt == "":
		return safety
	default:
		return safety + "\n" + channelPrompt
	}
}
