package types

import (
	"errors"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestNewAPIErrorSetMessageUpdatesRelayError(t *testing.T) {
	t.Run("OpenAI", func(t *testing.T) {
		err := WithOpenAIError(OpenAIError{
			Message: "old message",
			Type:    "invalid_request_error",
			Code:    ErrorCodeSensitiveWordsDetected,
		}, http.StatusBadRequest)

		err.SetMessage("new message with request id")

		response := err.ToOpenAIError()
		assert.Equal(t, "new message with request id", response.Message)
		assert.Equal(t, "invalid_request_error", response.Type)
		assert.Equal(t, ErrorCodeSensitiveWordsDetected, response.Code)
	})

	t.Run("Claude", func(t *testing.T) {
		err := WithClaudeError(ClaudeError{Type: "invalid_request_error", Message: "old message"}, http.StatusBadRequest)

		err.SetMessage("new message with request id")

		assert.Equal(t, "new message with request id", err.ToClaudeError().Message)
	})
}

func TestNewAPIErrorSetMessageAndConversionSupportRelayErrorPointers(t *testing.T) {
	t.Run("OpenAI pointer", func(t *testing.T) {
		relayError := &OpenAIError{
			Message: "old message",
			Type:    "invalid_request_error",
			Code:    ErrorCodeSensitiveWordsDetected,
		}
		err := &NewAPIError{
			Err:        errors.New(relayError.Message),
			RelayError: relayError,
			errorType:  ErrorTypeOpenAIError,
			errorCode:  ErrorCodeSensitiveWordsDetected,
		}

		err.SetMessage("new message")
		assert.Equal(t, "new message", relayError.Message)
		assert.Equal(t, "new message", err.ToOpenAIError().Message)
		assert.Equal(t, "new message", err.ToClaudeError().Message)
	})

	t.Run("Claude pointer", func(t *testing.T) {
		relayError := &ClaudeError{Type: "invalid_request_error", Message: "old message"}
		err := &NewAPIError{
			Err:        errors.New(relayError.Message),
			RelayError: relayError,
			errorType:  ErrorTypeClaudeError,
			errorCode:  ErrorCodeInvalidRequest,
		}

		err.SetMessage("new message")
		assert.Equal(t, "new message", relayError.Message)
		assert.Equal(t, "new message", err.ToClaudeError().Message)
		assert.Equal(t, "new message", err.ToOpenAIError().Message)
	})
}

func TestNewAPIErrorSetMessageIgnoresNilRelayErrorPointers(t *testing.T) {
	var openAIError *OpenAIError
	var claudeError *ClaudeError
	for _, relayError := range []any{openAIError, claudeError} {
		err := &NewAPIError{Err: errors.New("old"), RelayError: relayError}
		assert.NotPanics(t, func() { err.SetMessage("new") })
		assert.Equal(t, "new", err.Error())
	}
}

func TestNewAPIErrorConversionsHandleNilReceiver(t *testing.T) {
	var err *NewAPIError
	assert.Equal(t, OpenAIError{}, err.ToOpenAIError())
	assert.Equal(t, ClaudeError{}, err.ToClaudeError())
}
