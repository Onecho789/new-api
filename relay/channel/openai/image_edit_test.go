package openai

import (
	"bytes"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/relay/helper"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestConvertImageEditRequestMultipart verifies that ConvertImageRequest
// re-serializes multipart image edit requests with all fields (including
// stream) and the file intact, both when the form was already parsed and when
// it must be re-parsed from the reusable body.
func TestConvertImageEditRequestMultipart(t *testing.T) {
	gin.SetMode(gin.TestMode)

	newMultipartContext := func(t *testing.T, prompt string) *gin.Context {
		var body bytes.Buffer
		writer := multipart.NewWriter(&body)
		require.NoError(t, writer.WriteField("model", "gpt-image-1"))
		require.NoError(t, writer.WriteField("prompt", prompt))
		require.NoError(t, writer.WriteField("stream", "true"))
		require.NoError(t, writer.WriteField("partial_images", "3"))
		part, err := writer.CreateFormFile("image", "input.png")
		require.NoError(t, err)
		_, err = part.Write([]byte("fake image"))
		require.NoError(t, err)
		require.NoError(t, writer.WriteField("complexity", "low"))
		for _, name := range []string{"mask", "markup"} {
			part, err := writer.CreateFormFile(name, name+".png")
			require.NoError(t, err)
			_, err = part.Write([]byte("fake " + name))
			require.NoError(t, err)
		}
		require.NoError(t, writer.Close())

		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest(http.MethodPost, "/v1/images/edits", &body)
		c.Request.Header.Set("Content-Type", writer.FormDataContentType())
		return c
	}

	convertAndReplay := func(t *testing.T, c *gin.Context, prompt string) {
		info := &relaycommon.RelayInfo{
			RelayMode: relayconstant.RelayModeImagesEdits,
		}
		request := dto.ImageRequest{
			Model:  "gpt-image-1",
			Prompt: prompt,
			Stream: common.GetPointer(true),
		}

		converted, err := (&Adaptor{}).ConvertImageRequest(c, info, request)
		require.NoError(t, err)
		convertedBody, ok := converted.(*bytes.Buffer)
		require.True(t, ok)

		replayedRequest := httptest.NewRequest(http.MethodPost, "/v1/images/edits", bytes.NewReader(convertedBody.Bytes()))
		replayedRequest.Header.Set("Content-Type", c.Request.Header.Get("Content-Type"))
		require.NoError(t, replayedRequest.ParseMultipartForm(32<<20))

		require.Equal(t, "gpt-image-1", replayedRequest.PostForm.Get("model"))
		require.Equal(t, prompt, replayedRequest.PostForm.Get("prompt"))
		require.Equal(t, "true", replayedRequest.PostForm.Get("stream"))
		require.Equal(t, "3", replayedRequest.PostForm.Get("partial_images"))
		require.Len(t, replayedRequest.MultipartForm.File["image"], 1)
		require.Equal(t, "low", replayedRequest.PostForm.Get("complexity"))
		require.Len(t, replayedRequest.MultipartForm.File["mask"], 1)
		require.Len(t, replayedRequest.MultipartForm.File["markup"], 1)

		file, err := replayedRequest.MultipartForm.File["image"][0].Open()
		require.NoError(t, err)
		defer file.Close()
		fileBytes, err := io.ReadAll(file)
		require.NoError(t, err)
		require.Equal(t, []byte("fake image"), fileBytes)
	}

	t.Run("with pre-parsed form", func(t *testing.T) {
		prompt := "edit this image"
		c := newMultipartContext(t, prompt)
		require.NoError(t, c.Request.ParseMultipartForm(32<<20))

		convertAndReplay(t, c, prompt)
	})

	t.Run("re-parses reusable body when form is missing", func(t *testing.T) {
		prompt := "edit without pre-parsed form"
		c := newMultipartContext(t, prompt)

		storage, err := common.GetBodyStorage(c)
		require.NoError(t, err)
		c.Request.Body = io.NopCloser(storage)
		c.Request.MultipartForm = nil
		c.Request.PostForm = nil

		convertAndReplay(t, c, prompt)
	})
}

func TestConvertImageEditRequestPreservesGIFReferenceAndOutputOptions(t *testing.T) {
	gin.SetMode(gin.TestMode)
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	fields := map[string]string{
		"model":             "gpt-images-2.6",
		"prompt":            "animate the reference",
		"output_format":     "gif",
		"quality":           "high",
		"size":              "512x512",
		"frame_count":       "9",
		"frame_duration_ms": "200",
		"n":                 "1",
	}
	for key, value := range fields {
		require.NoError(t, writer.WriteField(key, value))
	}
	part, err := writer.CreateFormFile("image", "reference.GIF")
	require.NoError(t, err)
	imageBytes := []byte("GIF89a reference bytes")
	_, err = part.Write(imageBytes)
	require.NoError(t, err)
	require.NoError(t, writer.Close())

	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/images/edits", &body)
	c.Request.Header.Set("Content-Type", writer.FormDataContentType())
	request, err := helper.GetAndValidOpenAIImageRequest(c, relayconstant.RelayModeImagesEdits)
	require.NoError(t, err)
	converted, err := (&Adaptor{}).ConvertImageRequest(c, &relaycommon.RelayInfo{
		RelayMode: relayconstant.RelayModeImagesEdits,
	}, *request)
	require.NoError(t, err)
	convertedBody, ok := converted.(*bytes.Buffer)
	require.True(t, ok)
	replayed := httptest.NewRequest(http.MethodPost, "/v1/images/edits", bytes.NewReader(convertedBody.Bytes()))
	replayed.Header.Set("Content-Type", c.Request.Header.Get("Content-Type"))
	require.NoError(t, replayed.ParseMultipartForm(32<<20))

	for key, value := range fields {
		assert.Equal(t, value, replayed.PostForm.Get(key), key)
	}
	require.Len(t, replayed.MultipartForm.File["image"], 1)
	reference := replayed.MultipartForm.File["image"][0]
	assert.Equal(t, "image/gif", reference.Header.Get("Content-Type"))
	assert.Equal(t, "reference.GIF", reference.Filename)
	file, err := reference.Open()
	require.NoError(t, err)
	defer file.Close()
	forwardedBytes, err := io.ReadAll(file)
	require.NoError(t, err)
	assert.Equal(t, imageBytes, forwardedBytes)
}

func TestConvertImageJSONRequestPreservesCustomOutputOptions(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, mode := range []int{relayconstant.RelayModeImagesGenerations, relayconstant.RelayModeImagesEdits} {
		for _, quality := range []string{"auto", "high", "medium", "low"} {
			path := "/v1/images/generations"
			if mode == relayconstant.RelayModeImagesEdits {
				path = "/v1/images/edits"
			}
			t.Run(path+"/"+quality, func(t *testing.T) {
				expected := map[string]any{
					"model":             "gpt-images-2.6",
					"prompt":            "an animated landscape",
					"quality":           quality,
					"output_format":     "gif",
					"size":              "512x512",
					"frame_count":       float64(12),
					"frame_duration_ms": float64(80),
					"n":                 float64(1),
				}
				body, err := common.Marshal(expected)
				require.NoError(t, err)
				c, _ := gin.CreateTestContext(httptest.NewRecorder())
				c.Request = httptest.NewRequest(http.MethodPost, path, bytes.NewReader(body))
				c.Request.Header.Set("Content-Type", "application/json")
				request, err := helper.GetAndValidOpenAIImageRequest(c, mode)
				require.NoError(t, err)
				converted, err := (&Adaptor{}).ConvertImageRequest(c, &relaycommon.RelayInfo{RelayMode: mode}, *request)
				require.NoError(t, err)
				outbound, err := common.Marshal(converted)
				require.NoError(t, err)
				var actual map[string]any
				require.NoError(t, common.Unmarshal(outbound, &actual))
				assert.Equal(t, expected, actual)
			})
		}
	}
}

func TestConvertImageJSONRequestKeepsOptionalAnimationFields(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, tc := range []struct {
		name       string
		body       string
		wantFields bool
	}{
		{"omitted controls stay omitted for PNG", `{"model":"gpt-images-2.6","prompt":"a still image","output_format":"png"}`, false},
		{"explicit zero reaches provider validation", `{"model":"gpt-images-2.6","prompt":"an animation","output_format":"gif","frame_count":0,"frame_duration_ms":0}`, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest(http.MethodPost, "/v1/images/generations", bytes.NewBufferString(tc.body))
			c.Request.Header.Set("Content-Type", "application/json")
			request, err := helper.GetAndValidOpenAIImageRequest(c, relayconstant.RelayModeImagesGenerations)
			require.NoError(t, err)
			converted, err := (&Adaptor{}).ConvertImageRequest(c, &relaycommon.RelayInfo{RelayMode: relayconstant.RelayModeImagesGenerations}, *request)
			require.NoError(t, err)
			body, err := common.Marshal(converted)
			require.NoError(t, err)
			var actual map[string]any
			require.NoError(t, common.Unmarshal(body, &actual))
			for _, field := range []string{"frame_count", "frame_duration_ms"} {
				if tc.wantFields {
					assert.Equal(t, float64(0), actual[field], field)
				} else {
					assert.NotContains(t, actual, field)
				}
			}
		})
	}
}
