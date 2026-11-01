package controller

import (
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

// 普通用户只能读取已启用的说明；管理接口（/api/guide/admin）可读取全部。
func GetUserGuides(c *gin.Context) {
	guides, err := model.GetUserGuides(true)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, guides)
}

func GetUserGuide(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	guide, err := model.GetUserGuide(id, true)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, guide)
}

func AdminGetUserGuides(c *gin.Context) {
	guides, err := model.GetUserGuides(false)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, guides)
}

func AdminGetUserGuide(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	guide, err := model.GetUserGuide(id, false)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, guide)
}

func SaveUserGuide(c *gin.Context) {
	var input struct {
		Title     string `json:"title"`
		Format    string `json:"format"`
		Content   string `json:"content"`
		SortOrder int    `json:"sort_order"`
		Enabled   bool   `json:"enabled"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	guide := model.UserGuide{
		Title:     input.Title,
		Format:    input.Format,
		Content:   model.LongText(input.Content),
		SortOrder: input.SortOrder,
		Enabled:   input.Enabled,
	}
	if raw := c.Param("id"); raw != "" {
		id, err := strconv.Atoi(raw)
		if err != nil || id <= 0 {
			common.ApiErrorT(c, "Invalid parameters")
			return
		}
		guide.Id = id
	}
	if err := guide.Save(); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, guide)
}

func DeleteUserGuide(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	if err := model.DeleteUserGuide(id); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}
