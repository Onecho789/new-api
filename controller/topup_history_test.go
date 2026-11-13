package controller

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestTopUpHistoryUserFilterDatabaseMatrix(t *testing.T) {
	require.NoError(t, i18n.Init())
	gin.SetMode(gin.TestMode)
	for _, dialect := range []struct{ kind, env string }{
		{"sqlite", ""}, {"mysql", "TEST_MYSQL_DSN"}, {"postgres", "TEST_POSTGRES_DSN"},
	} {
		t.Run(dialect.kind, func(t *testing.T) {
			if dialect.env != "" && os.Getenv(dialect.env) == "" {
				t.Skip(dialect.env + " is not configured")
			}
			db, _ := newAuditTestDatabase(t, dialect.kind, os.Getenv(dialect.env))
			previousDB, previousType := model.DB, common.MainDatabaseType()
			model.DB = db
			common.SetMainDatabaseType(common.DatabaseType(dialect.kind))
			t.Cleanup(func() {
				model.DB = previousDB
				common.SetMainDatabaseType(previousType)
			})
			require.NoError(t, db.AutoMigrate(&model.TopUp{}))
			versionQuery := "SELECT version()"
			if dialect.kind == "sqlite" {
				versionQuery = "SELECT sqlite_version()"
			}
			var version string
			require.NoError(t, db.Raw(versionQuery).Scan(&version).Error)
			t.Logf("database version: %s", version)
			now := common.GetTimestamp()
			rows := []model.TopUp{
				{UserId: 12, TradeNo: "order-old-alpha", CreateTime: now - 45*24*60*60},
				{UserId: 12, TradeNo: "order-alpha-first", CreateTime: now},
				{UserId: 123, TradeNo: "order-123-alpha", CreateTime: now},
				{UserId: 7, TradeNo: "order-user-12-other", CreateTime: now},
				{UserId: 12, TradeNo: "order-beta", CreateTime: now},
				{UserId: 12, TradeNo: "order-alpha-last", CreateTime: now},
				{UserId: 123, TradeNo: "order-beta-123", CreateTime: now},
			}
			require.NoError(t, db.Create(&rows).Error)
			for _, tc := range []struct {
				name, query string
				selfID      int
				total       int
				indices     []int
			}{
				{"unfiltered", "", 0, 7, []int{6, 5, 4, 3, 2, 1, 0}},
				{"exact user ID", "user_id=12", 0, 4, []int{5, 4, 1, 0}},
				{"different exact user ID", "user_id=123", 0, 2, []int{6, 2}},
				{"combined user and order", "user_id=12&keyword=" + url.QueryEscape("%alpha%"), 0, 3, []int{5, 1, 0}},
				{"admin old order remains searchable", "user_id=12&keyword=" + url.QueryEscape("%old%"), 0, 1, []int{0}},
				{"numeric order keyword stays an order search", "keyword=" + url.QueryEscape("%12%"), 0, 3, []int{6, 3, 2}},
				{"user ID is not matched against order digits", "user_id=12&keyword=" + url.QueryEscape("%12%"), 0, 0, nil},
				{"plain keyword remains an exact order search", "keyword=order-beta", 0, 1, []int{4}},
				{"plain partial keyword does not gain implicit wildcards", "keyword=alpha", 0, 0, nil},
				{"combined exact order search", "user_id=12&keyword=order-beta", 0, 1, []int{4}},
				{"filtered first page", "user_id=12&page_size=2&p=1", 0, 4, []int{5, 4}},
				{"filtered second page includes old order", "user_id=12&page_size=2&p=2", 0, 4, []int{1, 0}},
				{"filtered page past end retains total", "user_id=12&page_size=2&p=3", 0, 4, nil},
				{"combined second page", "user_id=12&keyword=" + url.QueryEscape("%alpha%") + "&page_size=2&p=2", 0, 3, []int{0}},
				{"unknown user", "user_id=999", 0, 0, nil},
				{"no matching order", "user_id=12&keyword=does-not-exist", 0, 0, nil},
				{"clear user filter", "user_id=", 0, 7, []int{6, 5, 4, 3, 2, 1, 0}},
				{"clear user filter keeps order search", "user_id=&keyword=" + url.QueryEscape("%alpha%"), 0, 4, []int{5, 2, 1, 0}},
				{"clear keyword keeps user filter", "user_id=12&keyword=", 0, 4, []int{5, 4, 1, 0}},
				{"self retains thirty day window", "", 12, 3, []int{5, 4, 1}},
				{"self ignores another user ID", "user_id=123", 12, 3, []int{5, 4, 1}},
				{"self order search stays isolated", "user_id=123&keyword=" + url.QueryEscape("%alpha%"), 12, 2, []int{5, 1}},
				{"self cannot search another user's order", "user_id=123&keyword=" + url.QueryEscape("%123%"), 12, 0, nil},
				{"self cannot query old order through admin filter", "user_id=12&keyword=" + url.QueryEscape("%old%"), 12, 0, nil},
				{"self cannot clear identity restriction", "user_id=", 123, 2, []int{6, 2}},
				{"self ignores invalid admin-only filter", "user_id=anything", 12, 3, []int{5, 4, 1}},
			} {
				t.Run(tc.name, func(t *testing.T) {
					recorder := httptest.NewRecorder()
					c, _ := gin.CreateTestContext(recorder)
					path := "/api/user/topup"
					handler := GetAllTopUps
					if tc.selfID > 0 {
						path += "/self"
						c.Set("id", tc.selfID)
						handler = GetUserTopUps
					}
					c.Request = httptest.NewRequest(http.MethodGet, path+"?"+tc.query, nil)
					handler(c)
					require.Equal(t, http.StatusOK, recorder.Code)
					var response struct {
						Success bool
						Data    struct {
							Total int
							Items []model.TopUp
						}
					}
					require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response), recorder.Body.String())
					require.True(t, response.Success, recorder.Body.String())
					assert.Equal(t, tc.total, response.Data.Total)
					actualIDs, expectedIDs := make([]int, 0, len(response.Data.Items)), make([]int, 0, len(tc.indices))
					for _, item := range response.Data.Items {
						actualIDs = append(actualIDs, item.Id)
						if tc.selfID > 0 {
							assert.Equal(t, tc.selfID, item.UserId)
						}
					}
					for _, index := range tc.indices {
						expectedIDs = append(expectedIDs, rows[index].Id)
					}
					assert.Equal(t, expectedIDs, actualIDs)
				})
			}
			for _, value := range []string{"0", "-12", "1.5", "1e2", "abc", " 12 ", "+12", "9223372036854775808", "18446744073709551616", "12 OR 1=1"} {
				t.Run("invalid user ID "+value, func(t *testing.T) {
					recorder := httptest.NewRecorder()
					c, _ := gin.CreateTestContext(recorder)
					c.Request = httptest.NewRequest(http.MethodGet, "/api/user/topup?user_id="+url.QueryEscape(value), nil)
					GetAllTopUps(c)
					require.Equal(t, http.StatusBadRequest, recorder.Code)
					var response struct {
						Success    bool
						MessageKey string `json:"message_key"`
					}
					require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
					assert.False(t, response.Success)
					assert.Equal(t, "Invalid user ID", response.MessageKey)
				})
			}
			t.Run("existing model callers remain unfiltered", func(t *testing.T) {
				page := &common.PageInfo{Page: 1, PageSize: 2}
				items, total, err := model.GetAllTopUps(page)
				require.NoError(t, err)
				assert.EqualValues(t, 7, total)
				require.Len(t, items, 2)
				assert.Equal(t, rows[6].Id, items[0].Id)
				assert.Equal(t, rows[5].Id, items[1].Id)
				items, total, err = model.SearchAllTopUps("%12%", page)
				require.NoError(t, err)
				assert.EqualValues(t, 3, total)
				require.Len(t, items, 2)
				assert.Equal(t, rows[6].Id, items[0].Id)
				assert.Equal(t, rows[3].Id, items[1].Id)
			})
		})
	}
}
