package controller

import (
	"bytes"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestUserGuidesDatabaseMatrix(t *testing.T) {
	for _, database := range []struct {
		name, env string
		typ       common.DatabaseType
	}{
		{"sqlite", "", common.DatabaseTypeSQLite},
		{"mysql", "AUDIT_MYSQL_DSN", common.DatabaseTypeMySQL},
		{"postgres", "AUDIT_POSTGRES_DSN", common.DatabaseTypePostgreSQL},
	} {
		t.Run(database.name, func(t *testing.T) {
			dsn := os.Getenv(database.env)
			if database.env != "" && dsn == "" {
				t.Skip(database.env + " is not configured")
			}
			previousDB, previousMain, previousLog := model.DB, common.MainDatabaseType(), common.LogDatabaseType()
			t.Cleanup(func() {
				model.DB = previousDB
				common.SetDatabaseTypes(previousMain, previousLog)
			})
			db, _ := newAuditTestDatabase(t, database.name, dsn)
			model.DB = db
			common.SetDatabaseTypes(database.typ, database.typ)
			require.NoError(t, i18n.Init())
			// 重复迁移必须幂等，且不能丢失已有文档。
			require.NoError(t, db.AutoMigrate(&model.UserGuide{}))
			require.NoError(t, db.Create(&model.UserGuide{Title: "existing", Format: model.UserGuideFormatMarkdown, Content: "kept", Enabled: true}).Error)
			require.NoError(t, db.AutoMigrate(&model.UserGuide{}))
			var kept model.UserGuide
			require.NoError(t, db.Where("title = ?", "existing").First(&kept).Error)
			assert.Equal(t, model.LongText("kept"), kept.Content)
			require.NoError(t, db.Delete(&kept).Error)
			verifyUserGuides(t)
		})
	}
}

func verifyUserGuides(t *testing.T) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.GET("/api/guide/", GetUserGuides)
	router.GET("/api/guide/:id", GetUserGuide)
	router.GET("/api/guide/admin/", AdminGetUserGuides)
	router.GET("/api/guide/admin/:id", AdminGetUserGuide)
	router.POST("/api/guide/admin/", SaveUserGuide)
	router.PUT("/api/guide/admin/:id", SaveUserGuide)
	router.DELETE("/api/guide/admin/:id", DeleteUserGuide)
	request := func(method, path string, body any) tokenAPIResponse {
		payload, err := common.Marshal(body)
		require.NoError(t, err)
		req := httptest.NewRequest(method, path, bytes.NewReader(payload))
		req.Header.Set("Content-Type", "application/json")
		response := httptest.NewRecorder()
		router.ServeHTTP(response, req)
		require.Equal(t, http.StatusOK, response.Code)
		return decodeAPIResponse(t, response)
	}
	decodeGuide := func(response tokenAPIResponse) model.UserGuide {
		require.True(t, response.Success, response.Message)
		var guide model.UserGuide
		require.NoError(t, common.Unmarshal(response.Data, &guide))
		return guide
	}

	for _, invalid := range []gin.H{
		{"title": " ", "format": "markdown", "content": "x"},
		{"title": strings.Repeat("界", 129), "format": "markdown", "content": "x"},
		{"title": "t", "format": "pdf", "content": "x"},
		{"title": "t", "format": "markdown", "content": "  \n "},
		{"title": "t", "format": "markdown", "content": strings.Repeat("a", 200001)},
	} {
		assert.False(t, request("POST", "/api/guide/admin/", invalid).Success, invalid["title"])
	}

	// 正文超过 MySQL TEXT 的 64 KiB 上限，验证 LongText 列能完整保存。
	longContent := "# 视频模型调用\n\n" + strings.Repeat("示例参数说明。", 6000)
	video := decodeGuide(request("POST", "/api/guide/admin/", gin.H{"title": "  视频模型  ", "format": "markdown", "content": longContent, "sort_order": 2, "enabled": true}))
	assert.Equal(t, "视频模型", video.Title)
	assert.Positive(t, video.CreatedTime)
	image := decodeGuide(request("POST", "/api/guide/admin/", gin.H{"title": "图片模型", "format": "html", "content": "<h1>图片</h1>", "sort_order": 1, "enabled": true}))
	draft := decodeGuide(request("POST", "/api/guide/admin/", gin.H{"title": "草稿", "format": "markdown", "content": "draft", "sort_order": 0, "enabled": false}))

	listTitles := func(path string) []string {
		response := request("GET", path, nil)
		require.True(t, response.Success, response.Message)
		var guides []map[string]any
		require.NoError(t, common.Unmarshal(response.Data, &guides))
		titles := make([]string, 0, len(guides))
		for _, guide := range guides {
			assert.NotContains(t, guide, "content", "list responses must not carry document bodies")
			titles = append(titles, guide["title"].(string))
		}
		return titles
	}
	assert.Equal(t, []string{"图片模型", "视频模型"}, listTitles("/api/guide/"))
	assert.Equal(t, []string{"草稿", "图片模型", "视频模型"}, listTitles("/api/guide/admin/"))

	fetched := decodeGuide(request("GET", fmt.Sprintf("/api/guide/%d", video.Id), nil))
	assert.Equal(t, model.LongText(longContent), fetched.Content)
	assert.False(t, request("GET", fmt.Sprintf("/api/guide/%d", draft.Id), nil).Success, "disabled guides are hidden from readers")
	assert.Equal(t, model.LongText("draft"), decodeGuide(request("GET", fmt.Sprintf("/api/guide/admin/%d", draft.Id), nil)).Content)

	updated := decodeGuide(request("PUT", fmt.Sprintf("/api/guide/admin/%d", image.Id), gin.H{"title": "图片模型", "format": "html", "content": "<h1>图片</h1>", "sort_order": 9, "enabled": true}))
	assert.Equal(t, image.CreatedTime, updated.CreatedTime, "an unchanged update must still succeed and keep created_time")
	assert.Equal(t, []string{"视频模型", "图片模型"}, listTitles("/api/guide/"))
	decodeGuide(request("PUT", fmt.Sprintf("/api/guide/admin/%d", draft.Id), gin.H{"title": "草稿", "format": "markdown", "content": "draft", "enabled": true}))
	assert.Equal(t, []string{"草稿", "视频模型", "图片模型"}, listTitles("/api/guide/"))

	for _, path := range []string{"/api/guide/admin/999999", "/api/guide/admin/abc", "/api/guide/admin/-1"} {
		assert.False(t, request("PUT", path, gin.H{"title": "t", "format": "markdown", "content": "x"}).Success, path)
		assert.False(t, request("DELETE", path, nil).Success, path)
	}
	require.True(t, request("DELETE", fmt.Sprintf("/api/guide/admin/%d", video.Id), nil).Success)
	assert.False(t, request("GET", fmt.Sprintf("/api/guide/admin/%d", video.Id), nil).Success)
	assert.Equal(t, []string{"草稿", "图片模型"}, listTitles("/api/guide/admin/"))
}
