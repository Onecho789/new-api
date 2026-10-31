package model

import (
	"errors"
	"strings"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

var (
	ErrTokenCategoryNotFound      error = common.NewMessage("Token category not found")
	ErrTokenCategoryNameInvalid   error = common.NewMessage("Category name must contain 1–64 characters")
	ErrTokenCategoryNameDuplicate error = common.NewMessage("A category with this name already exists")
)

// TokenCategory 仅用于用户整理密钥，与调用路由分组无关。
type TokenCategory struct {
	Id          int    `json:"id"`
	UserId      int    `json:"-" gorm:"not null;uniqueIndex:idx_token_category_user_name,priority:1"`
	Name        string `json:"name" gorm:"type:varchar(64);not null;uniqueIndex:idx_token_category_user_name,priority:2"`
	CreatedTime int64  `json:"created_time" gorm:"bigint"`
	TokenCount  int64  `json:"token_count" gorm:"-"`
}

func GetTokenCategories(userId int) ([]TokenCategory, error) {
	categories := make([]TokenCategory, 0)
	if err := DB.Where("user_id = ?", userId).Order("id desc").Find(&categories).Error; err != nil {
		return nil, err
	}
	var counts []struct {
		CategoryId int
		TokenCount int64
	}
	if err := DB.Model(&Token{}).Select("category_id, COUNT(*) AS token_count").Where("user_id = ? AND category_id > 0", userId).Group("category_id").Scan(&counts).Error; err != nil {
		return nil, err
	}
	byID := make(map[int]int64, len(counts))
	for _, count := range counts {
		byID[count.CategoryId] = count.TokenCount
	}
	for i := range categories {
		categories[i].TokenCount = byID[categories[i].Id]
	}
	return categories, nil
}

func GetTokenCategory(id, userId int) (*TokenCategory, error) {
	var category TokenCategory
	err := DB.Where("id = ? AND user_id = ?", id, userId).First(&category).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		err = ErrTokenCategoryNotFound
	}
	return &category, err
}

func (category *TokenCategory) Save() error {
	category.Name = strings.TrimSpace(category.Name)
	if category.Name == "" || utf8.RuneCountInString(category.Name) > 64 {
		return ErrTokenCategoryNameInvalid
	}
	var count int64
	if err := DB.Model(&TokenCategory{}).Where("user_id = ? AND name = ? AND id <> ?", category.UserId, category.Name, category.Id).Count(&count).Error; err != nil {
		return err
	}
	if count > 0 {
		return ErrTokenCategoryNameDuplicate
	}
	var err error
	if category.Id == 0 {
		category.CreatedTime = common.GetTimestamp()
		err = DB.Create(category).Error
	} else {
		err = DB.Transaction(func(tx *gorm.DB) error {
			if err := lockTokenCategory(tx, category.Id, category.UserId); err != nil {
				return err
			}
			return tx.Model(&TokenCategory{}).Where("id = ? AND user_id = ?", category.Id, category.UserId).Update("name", category.Name).Error
		})
	}
	// 唯一索引处理并发重名；在事务结束后查询，兼容 PostgreSQL 错误事务语义。
	if err != nil {
		if lookupErr := DB.Model(&TokenCategory{}).Where("user_id = ? AND name = ? AND id <> ?", category.UserId, category.Name, category.Id).Count(&count).Error; lookupErr == nil && count > 0 {
			return ErrTokenCategoryNameDuplicate
		}
	}
	return err
}

func DeleteTokenCategory(id, userId int) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		if err := lockTokenCategory(tx, id, userId); err != nil {
			return err
		}
		if err := tx.Model(&Token{}).Where("user_id = ? AND category_id = ?", userId, id).Update("category_id", 0).Error; err != nil {
			return err
		}
		return tx.Where("id = ? AND user_id = ?", id, userId).Delete(&TokenCategory{}).Error
	})
}

// 分类归属写入和删除持有同一行锁，防止删除后再次写入失效分类。
func lockTokenCategory(tx *gorm.DB, id, userId int) error {
	if id <= 0 {
		return ErrTokenCategoryNotFound
	}
	var category TokenCategory
	err := lockForUpdate(tx).Select("id").Where("id = ? AND user_id = ?", id, userId).First(&category).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return ErrTokenCategoryNotFound
	}
	return err
}
