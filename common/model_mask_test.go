package common

import (
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/constant"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

func TestMaskUpstreamModelInData(t *testing.T) {
	for _, tc := range []struct {
		name, request, mapping, input, expected string
	}{
		{"unmapped response stays intact", "alias", "{}", `{"model":"upstream"}`, `{"model":"upstream"}`},
		{"mapped model does not replace a longer model", "alias", `{"alias":"gpt-4"}`, `{"model":"gpt-4","other":"gpt-4o"}`, `{"model":"alias","other":"gpt-4o"}`},
		{"mapping chain masks all intermediate names", "alias", `{"alias":"middle","middle":"upstream"}`, `{"model":"middle","modelVersion":"upstream"}`, `{"model":"alias","modelVersion":"alias"}`},
		{"mapping cycle terminates", "alias", `{"alias":"upstream","upstream":"alias"}`, `{"model":"upstream"}`, `{"model":"alias"}`},
		{"quoted model names remain valid JSON", `public"model`, `{"public\"model":"private\"model"}`, `{"model":"private\"model"}`, `{"model":"public\"model"}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
			SetContextKey(ctx, constant.ContextKeyOriginalModel, tc.request)
			SetContextKey(ctx, constant.ContextKeyChannelModelMapping, tc.mapping)
			assert.Equal(t, tc.expected, string(MaskUpstreamModelInData(ctx, []byte(tc.input))))
		})
	}
}

func TestMaskUpstreamModelInDataRefreshesOnChannelRetry(t *testing.T) {
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	SetContextKey(ctx, constant.ContextKeyOriginalModel, "alias")
	SetContextKey(ctx, constant.ContextKeyChannelModelMapping, `{"alias":"first"}`)
	assert.JSONEq(t, `{"model":"alias"}`, string(MaskUpstreamModelInData(ctx, []byte(`{"model":"first"}`))))
	SetContextKey(ctx, constant.ContextKeyChannelModelMapping, `{"alias":"second"}`)
	assert.JSONEq(t, `{"model":"alias"}`, string(MaskUpstreamModelInData(ctx, []byte(`{"model":"second"}`))))
}

func TestMaskUpstreamModelInTextReplacesLongestNamesOnce(t *testing.T) {
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	SetContextKey(ctx, constant.ContextKeyOriginalModel, "public-upstream")
	SetContextKey(ctx, constant.ContextKeyChannelModelMapping, `{"public-upstream":"upstream","upstream":"upstream-long"}`)
	assert.Equal(t, "models public-upstream and public-upstream failed", MaskUpstreamModelInText(ctx, "models upstream-long and upstream failed"))
}
