package common

import (
	"bytes"

	"github.com/QuantumNous/new-api/constant"

	"github.com/gin-gonic/gin"
)

// CUSTOM: 隐藏实际上游模型 —— 响应体脱敏。
// 本文件为自定义改动，用于将 API 响应体（含流式 chunk）中出现的"真实上游模型名"
// 替换回用户请求的模型名，防止 model / modelVersion 字段泄露渠道 model_mapping 后的真实模型。
// 与日志脱敏（log_info_generate.go / task_billing.go / relay.go）属于两条独立路径，此处针对响应体。

// customModelMaskCacheKey 缓存本次请求计算出的替换对，避免每个流式 chunk 重复解析 model_mapping。
const customModelMaskCacheKey = "custom_model_mask_pairs"

// customModelMaskPair 一个替换对：把 from（带引号的上游模型名）替换为 to（带引号的请求模型名）。
type customModelMaskPair struct {
	from []byte
	to   []byte
}

// MaskUpstreamModelInData 将响应数据中出现的真实上游模型名替换回用户请求的模型名。
// 采用"加引号精确替换"（如 "claude-sonnet-4-6" -> "claude-sonnet"），
// 加引号可避免子串误伤（如 gpt-4 不会误伤 gpt-4o），且对 OpenAI/Claude/Gemini/SSE 各种 JSON 格式通用。
// 若渠道未配置 model_mapping 或映射后与请求模型一致，则原样返回（零开销快速路径）。
func MaskUpstreamModelInData(c *gin.Context, data []byte) []byte {
	if c == nil || len(data) == 0 {
		return data
	}

	pairs := getModelMaskPairs(c)
	if len(pairs) == 0 {
		return data
	}

	for _, p := range pairs {
		if bytes.Contains(data, p.from) {
			data = bytes.ReplaceAll(data, p.from, p.to)
		}
	}
	return data
}

// getModelMaskPairs 返回本次请求需要替换的模型名对，结果缓存在 context 中。
func getModelMaskPairs(c *gin.Context) []customModelMaskPair {
	if cached, ok := c.Get(customModelMaskCacheKey); ok {
		if pairs, ok := cached.([]customModelMaskPair); ok {
			return pairs
		}
	}

	pairs := computeModelMaskPairs(c)
	c.Set(customModelMaskCacheKey, pairs)
	return pairs
}

// computeModelMaskPairs 根据 original_model 与 model_mapping 计算替换对。
// 沿映射链（含链式重定向）收集请求模型对应的所有上游模型名，逐一映射回请求模型名。
func computeModelMaskPairs(c *gin.Context) []customModelMaskPair {
	requestModel := GetContextKeyString(c, constant.ContextKeyOriginalModel)
	if requestModel == "" {
		return nil
	}

	modelMapping := GetContextKeyString(c, constant.ContextKeyChannelModelMapping)
	if modelMapping == "" || modelMapping == "{}" {
		return nil
	}

	modelMap := make(map[string]string)
	if err := UnmarshalJsonStr(modelMapping, &modelMap); err != nil {
		return nil
	}

	// 沿映射链收集 requestModel 对应的所有上游模型名（带循环保护）。
	current := requestModel
	visited := map[string]bool{current: true}
	for {
		mapped, ok := modelMap[current]
		if !ok || mapped == "" || visited[mapped] {
			break
		}
		visited[mapped] = true
		current = mapped
	}

	requestQuoted := []byte(`"` + requestModel + `"`)
	pairs := make([]customModelMaskPair, 0, len(visited))
	for upstreamModel := range visited {
		if upstreamModel == "" || upstreamModel == requestModel {
			continue
		}
		pairs = append(pairs, customModelMaskPair{
			from: []byte(`"` + upstreamModel + `"`),
			to:   requestQuoted,
		})
	}
	return pairs
}
