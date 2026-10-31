package volcengine

import (
	"encoding/json"
	"net/http/httptest"
	"testing"

	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/relaykit/dto"

	"github.com/gin-gonic/gin"
)

func TestConvertAudioRequestMetadataTextOverridesInput(t *testing.T) {
	adaptor := &Adaptor{}
	info := &relaycommon.RelayInfo{
		RelayMode:       relayconstant.RelayModeAudioSpeech,
		OriginModelName: "seed-tts-1",
		ChannelMeta:     &relaycommon.ChannelMeta{ApiKey: "APP_ID|TOKEN"},
	}
	request := dto.AudioRequest{
		Model:          "seed-tts-1",
		Input:          "safe input",
		Voice:          "voice-1",
		ResponseFormat: "mp3",
		Metadata:       json.RawMessage(`{"request":{"text":"BLOCK_MARKER"}}`),
	}

	reader, err := adaptor.ConvertAudioRequest(gin.CreateTestContextOnly(httptest.NewRecorder(), gin.New()), info, request)
	if err != nil {
		t.Fatalf("ConvertAudioRequest returned error: %v", err)
	}
	var payload VolcengineTTSRequest
	if err := json.NewDecoder(reader).Decode(&payload); err != nil {
		t.Fatalf("decode converted request: %v", err)
	}
	if payload.Request.Text != "BLOCK_MARKER" {
		t.Fatalf("request.text = %q, want metadata override", payload.Request.Text)
	}
}
