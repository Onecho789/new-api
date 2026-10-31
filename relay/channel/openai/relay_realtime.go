package openai

import (
	"fmt"
	"sync"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relay/helper"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"

	"github.com/bytedance/gopkg/util/gopool"
	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

// OpenAI Realtime accepts audio buffers up to roughly 15 MiB before Base64
// encoding. 32 MiB leaves room for JSON overhead while bounding allocations.
const maxRealtimeClientMessageBytes = 32 << 20

func OpenaiRealtimeHandler(c *gin.Context, info *relaycommon.RelayInfo) (*types.NewAPIError, *dto.RealtimeUsage) {
	if info == nil || info.ClientWs == nil || info.TargetWs == nil {
		return types.NewError(fmt.Errorf("invalid websocket connection"), types.ErrorCodeBadResponse), nil
	}

	info.IsStream = true
	clientConn := info.ClientWs
	targetConn := info.TargetWs
	clientConn.SetReadLimit(maxRealtimeClientMessageBytes)

	clientClosed := make(chan struct{})
	targetClosed := make(chan struct{})
	sendChan := make(chan []byte, 100)
	receiveChan := make(chan []byte, 100)
	errChan := make(chan error, 4)
	reportError := func(err error) {
		if err == nil {
			return
		}
		select {
		case errChan <- err:
		default:
			logger.LogError(c, "realtime error channel full: "+err.Error())
		}
	}
	var clientWriteMu sync.Mutex
	var targetWriteMu sync.Mutex
	var usageMu sync.Mutex
	var readers sync.WaitGroup
	writeClient := func(message []byte) error {
		clientWriteMu.Lock()
		defer clientWriteMu.Unlock()
		return helper.WssString(c, clientConn, string(message))
	}
	writeTarget := func(message []byte) error {
		targetWriteMu.Lock()
		defer targetWriteMu.Unlock()
		return helper.WssString(c, targetConn, string(message))
	}

	usage := &dto.RealtimeUsage{}
	localUsage := &dto.RealtimeUsage{}
	sumUsage := &dto.RealtimeUsage{}

	readers.Add(2)
	gopool.Go(func() {
		defer readers.Done()
		defer func() {
			if r := recover(); r != nil {
				reportError(fmt.Errorf("panic in client reader: %v", r))
			}
		}()
		for {
			select {
			case <-c.Done():
				return
			default:
				_, message, err := clientConn.ReadMessage()
				if err != nil {
					if !websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) {
						reportError(fmt.Errorf("error reading from client: %v", err))
					}
					close(clientClosed)
					return
				}

				realtimeEvent := &dto.RealtimeEvent{}
				err = common.Unmarshal(message, realtimeEvent)
				if err != nil {
					reportError(fmt.Errorf("error unmarshalling message: %v", err))
					return
				}

				usageMu.Lock()
				if realtimeEvent.Type == dto.RealtimeEventTypeSessionUpdate && realtimeEvent.Session != nil && realtimeEvent.Session.Tools != nil {
					info.RealtimeTools = realtimeEvent.Session.Tools
				}
				textToken, audioToken, err := service.CountTokenRealtime(info, *realtimeEvent, info.UpstreamModelName)
				if err == nil {
					localUsage.TotalTokens += textToken + audioToken
					localUsage.InputTokens += textToken + audioToken
					localUsage.InputTokenDetails.TextTokens += textToken
					localUsage.InputTokenDetails.AudioTokens += audioToken
				}
				usageMu.Unlock()
				if err != nil {
					reportError(fmt.Errorf("error counting text token: %v", err))
					return
				}
				logger.LogInfo(c, common.LogText("type: %s, textToken: %d, audioToken: %d", realtimeEvent.Type, textToken, audioToken))

				err = writeTarget(message)
				if err != nil {
					reportError(fmt.Errorf("error writing to target: %v", err))
					return
				}

				select {
				case sendChan <- message:
				default:
				}
			}
		}
	})

	gopool.Go(func() {
		defer readers.Done()
		defer func() {
			if r := recover(); r != nil {
				reportError(fmt.Errorf("panic in target reader: %v", r))
			}
		}()
		for {
			select {
			case <-c.Done():
				return
			default:
				_, message, err := targetConn.ReadMessage()
				if err != nil {
					if !websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) {
						reportError(fmt.Errorf("error reading from target: %v", err))
					}
					close(targetClosed)
					return
				}
				info.SetFirstResponseTime()
				realtimeEvent := &dto.RealtimeEvent{}
				err = common.Unmarshal(message, realtimeEvent)
				if err != nil {
					reportError(fmt.Errorf("error unmarshalling message: %v", err))
					return
				}

				if realtimeEvent.Type == dto.RealtimeEventTypeResponseDone {
					var realtimeUsage *dto.RealtimeUsage
					if realtimeEvent.Response != nil {
						realtimeUsage = realtimeEvent.Response.Usage
					}
					if realtimeUsage != nil {
						err := func() error {
							usageMu.Lock()
							defer usageMu.Unlock()
							usage.TotalTokens += realtimeUsage.TotalTokens
							usage.InputTokens += realtimeUsage.InputTokens
							usage.OutputTokens += realtimeUsage.OutputTokens
							usage.InputTokenDetails.AudioTokens += realtimeUsage.InputTokenDetails.AudioTokens
							usage.InputTokenDetails.CachedTokens += realtimeUsage.InputTokenDetails.CachedTokens
							usage.InputTokenDetails.TextTokens += realtimeUsage.InputTokenDetails.TextTokens
							usage.OutputTokenDetails.AudioTokens += realtimeUsage.OutputTokenDetails.AudioTokens
							usage.OutputTokenDetails.TextTokens += realtimeUsage.OutputTokenDetails.TextTokens
							if err := preConsumeUsage(c, info, usage, sumUsage); err != nil {
								return err
							}
							// 本次计费完成，清除
							usage = &dto.RealtimeUsage{}
							localUsage = &dto.RealtimeUsage{}
							return nil
						}()
						if err != nil {
							reportError(fmt.Errorf("error consume usage: %v", err))
							return
						}
					} else {
						var textToken, audioToken int
						err = func() error {
							usageMu.Lock()
							defer usageMu.Unlock()
							var err error
							textToken, audioToken, err = service.CountTokenRealtime(info, *realtimeEvent, info.UpstreamModelName)
							if err != nil {
								return fmt.Errorf("error counting text token: %v", err)
							}
							localUsage.TotalTokens += textToken + audioToken
							info.IsFirstRequest = false
							localUsage.InputTokens += textToken + audioToken
							localUsage.InputTokenDetails.TextTokens += textToken
							localUsage.InputTokenDetails.AudioTokens += audioToken
							if err := preConsumeUsage(c, info, localUsage, sumUsage); err != nil {
								return fmt.Errorf("error consume usage: %v", err)
							}
							// 本次计费完成，清除
							localUsage = &dto.RealtimeUsage{}
							return nil
						}()
						if err != nil {
							reportError(err)
							return
						}
						logger.LogInfo(c, common.LogText("type: %s, textToken: %d, audioToken: %d", realtimeEvent.Type, textToken, audioToken))
						// print now usage
					}
					logger.LogInfo(c, common.LogText("realtime streaming sumUsage: %v", sumUsage))
					usageMu.Lock()
					localUsageSnapshot := *localUsage
					usageMu.Unlock()
					logger.LogInfo(c, common.LogText("realtime streaming localUsage: %v", &localUsageSnapshot))
					logger.LogInfo(c, common.LogText("realtime streaming localUsage: %v", &localUsageSnapshot))

				} else if realtimeEvent.Type == dto.RealtimeEventTypeSessionUpdated || realtimeEvent.Type == dto.RealtimeEventTypeSessionCreated {
					realtimeSession := realtimeEvent.Session
					if realtimeSession != nil {
						// update audio format
						usageMu.Lock()
						info.InputAudioFormat = common.GetStringIfEmpty(realtimeSession.InputAudioFormat, info.InputAudioFormat)
						info.OutputAudioFormat = common.GetStringIfEmpty(realtimeSession.OutputAudioFormat, info.OutputAudioFormat)
						usageMu.Unlock()
					}
				} else {
					usageMu.Lock()
					textToken, audioToken, err := service.CountTokenRealtime(info, *realtimeEvent, info.UpstreamModelName)
					if err == nil {
						localUsage.TotalTokens += textToken + audioToken
						localUsage.OutputTokens += textToken + audioToken
						localUsage.OutputTokenDetails.TextTokens += textToken
						localUsage.OutputTokenDetails.AudioTokens += audioToken
					}
					usageMu.Unlock()
					if err != nil {
						reportError(fmt.Errorf("error counting text token: %v", err))
						return
					}
					logger.LogInfo(c, common.LogText("type: %s, textToken: %d, audioToken: %d", realtimeEvent.Type, textToken, audioToken))
				}

				err = writeClient(message)
				if err != nil {
					reportError(fmt.Errorf("error writing to client: %v", err))
					return
				}

				select {
				case receiveChan <- message:
				default:
				}
			}
		}
	})

	select {
	case <-clientClosed:
	case <-targetClosed:
	case err := <-errChan:
		//return service.OpenAIErrorWrapper(err, "realtime_error", http.StatusInternalServerError), nil
		logger.LogError(c, common.LogText("realtime error: %s", err.Error()))
	case <-c.Done():
	}

	// Closing both connections releases the reader that did not win the select.
	// Wait for both readers before inspecting their shared usage accumulators.
	_ = clientConn.Close()
	_ = targetConn.Close()
	readers.Wait()

	if usage.TotalTokens != 0 {
		_ = preConsumeUsage(c, info, usage, sumUsage)
	}

	if localUsage.TotalTokens != 0 {
		_ = preConsumeUsage(c, info, localUsage, sumUsage)
	}

	// check usage total tokens, if 0, use local usage

	return nil, sumUsage
}

func preConsumeUsage(ctx *gin.Context, info *relaycommon.RelayInfo, usage *dto.RealtimeUsage, totalUsage *dto.RealtimeUsage) error {
	if usage == nil || totalUsage == nil {
		return fmt.Errorf("invalid usage pointer")
	}

	totalUsage.TotalTokens += usage.TotalTokens
	totalUsage.InputTokens += usage.InputTokens
	totalUsage.OutputTokens += usage.OutputTokens
	totalUsage.InputTokenDetails.CachedTokens += usage.InputTokenDetails.CachedTokens
	totalUsage.InputTokenDetails.TextTokens += usage.InputTokenDetails.TextTokens
	totalUsage.InputTokenDetails.AudioTokens += usage.InputTokenDetails.AudioTokens
	totalUsage.OutputTokenDetails.TextTokens += usage.OutputTokenDetails.TextTokens
	totalUsage.OutputTokenDetails.AudioTokens += usage.OutputTokenDetails.AudioTokens
	// clear usage
	err := service.PreWssConsumeQuota(ctx, info, usage)
	return err
}
