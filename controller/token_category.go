package controller

import (
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

func tokenCategoryFilter(c *gin.Context) ([]int, bool) {
	values, present := c.Request.URL.Query()["category_id"]
	if !present {
		return nil, true
	}
	if len(values) != 1 {
		common.ApiErrorT(c, "Invalid parameters")
		return nil, false
	}
	id, err := strconv.Atoi(values[0])
	if err != nil || id < 0 {
		common.ApiErrorT(c, "Invalid parameters")
		return nil, false
	}
	if id > 0 {
		if _, err := model.GetTokenCategory(id, c.GetInt("id")); err != nil {
			common.ApiError(c, err)
			return nil, false
		}
	}
	return []int{id}, true
}

func GetTokenCategories(c *gin.Context) {
	categories, err := model.GetTokenCategories(c.GetInt("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, categories)
}

func SaveTokenCategory(c *gin.Context) {
	var input struct {
		Name string `json:"name"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	category := model.TokenCategory{UserId: c.GetInt("id"), Name: input.Name}
	if raw := c.Param("id"); raw != "" {
		id, err := strconv.Atoi(raw)
		if err != nil || id <= 0 {
			common.ApiErrorT(c, "Invalid parameters")
			return
		}
		existing, err := model.GetTokenCategory(id, category.UserId)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		category.Id, category.CreatedTime = existing.Id, existing.CreatedTime
	}
	if err := category.Save(); err != nil {
		common.ApiError(c, err)
		return
	}
	params := tokenAuditParams(c)
	params["id"], params["name"] = category.Id, category.Name
	common.SetContextKey(c, constant.ContextKeyTokenAuditSucceeded, true)
	common.ApiSuccess(c, category)
}

func DeleteTokenCategory(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	if err := model.DeleteTokenCategory(id, c.GetInt("id")); err != nil {
		common.ApiError(c, err)
		return
	}
	tokenAuditParams(c)["id"] = id
	common.SetContextKey(c, constant.ContextKeyTokenAuditSucceeded, true)
	common.ApiSuccess(c, nil)
}
