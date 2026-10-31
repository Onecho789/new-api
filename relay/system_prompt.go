package relay

import (
	"strings"

	"github.com/QuantumNous/new-api/common"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/dto"

	"github.com/gin-gonic/gin"
)

// applySystemPromptIfNeeded 将全局安全提示词与渠道级系统提示词注入 OpenAI Chat
// 请求。必须在格式转换之前调用，转换器会把 system 消息映射到目标协议的系统字段。
func applySystemPromptIfNeeded(c *gin.Context, info *relaycommon.RelayInfo, request *dto.GeneralOpenAIRequest) {
	if info == nil || request == nil {
		return
	}
	injection := relaycommon.ResolveSystemPromptInjection(info)

	systemRole := request.GetSystemRoleName()

	// Kimi K3 的 system tools 消息用于动态加载工具，提示词应写入独立消息。
	containSystemPrompt := false
	for _, message := range request.Messages {
		if message.Role == systemRole && len(message.Tools) == 0 {
			containSystemPrompt = true
			break
		}
	}
	if !containSystemPrompt {
		prompt := injection.BuildStandalone(c)
		if prompt == "" {
			return
		}
		systemMessage := dto.Message{
			Role:    systemRole,
			Content: prompt,
		}
		request.Messages = append([]dto.Message{systemMessage}, request.Messages...)
		return
	}

	prefix := injection.BuildPrefix(c)
	if prefix == "" {
		return
	}
	for i, message := range request.Messages {
		if message.Role != systemRole || len(message.Tools) > 0 {
			continue
		}
		if message.IsStringContent() {
			request.Messages[i].SetStringContent(prefix + "\n" + message.StringContent())
			return
		}
		contents := message.ParseContent()
		if len(contents) == 0 {
			// content 结构无法解析成媒体列表时不能改写它，否则会丢掉客户端内容；
			// 改为在其之前插入一条独立的系统消息。
			systemMessage := dto.Message{Role: systemRole, Content: prefix}
			request.Messages = append(request.Messages[:i], append([]dto.Message{systemMessage}, request.Messages[i:]...)...)
			return
		}
		contents = append([]dto.MediaContent{
			{
				Type: dto.ContentTypeText,
				Text: prefix,
			},
		}, contents...)
		// 必须走 SetMediaContent：直接赋值 Content 会让后续 ParseContent 拿不到内容
		// （它只接受 []any），从而丢掉整个 system 消息。
		request.Messages[i].SetMediaContent(contents)
		return
	}
}

// applyResponsesSystemPromptIfNeeded 将系统提示词注入 OpenAI Responses 请求的
// instructions 字段，需在格式转换之前调用。
func applyResponsesSystemPromptIfNeeded(c *gin.Context, info *relaycommon.RelayInfo, request *dto.OpenAIResponsesRequest) error {
	if info == nil || request == nil {
		return nil
	}
	injection := relaycommon.ResolveSystemPromptInjection(info)

	// instructions 按 OpenAI 规范是字符串；无法解析为字符串时视为无有效内容，
	// 与 codex adaptor 的既有处理保持一致。
	existing := ""
	if len(request.Instructions) > 0 {
		if err := common.Unmarshal(request.Instructions, &existing); err != nil {
			existing = ""
		}
	}
	existing = strings.TrimSpace(existing)

	text := ""
	if existing == "" {
		text = injection.BuildStandalone(c)
	} else if prefix := injection.BuildPrefix(c); prefix != "" {
		text = prefix + "\n" + existing
	}
	if text == "" {
		return nil
	}

	encoded, err := common.Marshal(text)
	if err != nil {
		return err
	}
	request.Instructions = encoded
	return nil
}

// applyClaudeSystemPromptIfNeeded 将系统提示词注入 Claude 原生请求的 system 字段，
// 该字段既可以是字符串，也可以是内容块数组。
func applyClaudeSystemPromptIfNeeded(c *gin.Context, info *relaycommon.RelayInfo, request *dto.ClaudeRequest) {
	if info == nil || request == nil {
		return
	}
	injection := relaycommon.ResolveSystemPromptInjection(info)

	if request.System == nil {
		if prompt := injection.BuildStandalone(c); prompt != "" {
			request.SetStringSystem(prompt)
		}
		return
	}

	prefix := injection.BuildPrefix(c)
	if prefix == "" {
		return
	}
	if request.IsStringSystem() {
		existing := strings.TrimSpace(request.GetStringSystem())
		if existing == "" {
			request.SetStringSystem(prefix)
		} else {
			request.SetStringSystem(prefix + "\n" + existing)
		}
		return
	}

	newSystem := dto.ClaudeMediaMessage{Type: dto.ContentTypeText}
	newSystem.SetText(prefix)
	systemContents := request.ParseSystem()
	if len(systemContents) == 0 {
		request.System = []dto.ClaudeMediaMessage{newSystem}
		return
	}
	request.System = append([]dto.ClaudeMediaMessage{newSystem}, systemContents...)
}

// applyGeminiSystemPromptIfNeeded 将系统提示词注入 Gemini 原生请求的
// systemInstruction。Gemini 的系统指令由多个 part 组成，注入到第一个非空 part 前面。
func applyGeminiSystemPromptIfNeeded(c *gin.Context, info *relaycommon.RelayInfo, request *dto.GeminiChatRequest) {
	if info == nil || request == nil {
		return
	}
	injection := relaycommon.ResolveSystemPromptInjection(info)

	if request.SystemInstructions == nil {
		if prompt := injection.BuildStandalone(c); prompt != "" {
			request.SystemInstructions = &dto.GeminiChatContent{
				Parts: []dto.GeminiPart{{Text: prompt}},
			}
		}
		return
	}

	// parts 为空等价于客户端没有提供系统指令，按独立注入处理。
	if len(request.SystemInstructions.Parts) == 0 {
		if prompt := injection.BuildStandalone(c); prompt != "" {
			request.SystemInstructions.Parts = []dto.GeminiPart{{Text: prompt}}
		}
		return
	}

	prefix := injection.BuildPrefix(c)
	if prefix == "" {
		return
	}
	for i := range request.SystemInstructions.Parts {
		if request.SystemInstructions.Parts[i].Text == "" {
			continue
		}
		request.SystemInstructions.Parts[i].Text = prefix + "\n" + request.SystemInstructions.Parts[i].Text
		return
	}
	// 所有 part 都没有文本（例如只带内联数据），只能新增一个文本 part。
	request.SystemInstructions.Parts = append([]dto.GeminiPart{{Text: prefix}}, request.SystemInstructions.Parts...)
}
