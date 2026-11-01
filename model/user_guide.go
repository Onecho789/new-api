package model

import (
	"errors"
	"strings"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

const (
	UserGuideFormatMarkdown = "markdown"
	UserGuideFormatHTML     = "html"

	userGuideTitleMaxRunes   = 128
	userGuideContentMaxRunes = 200000
)

var (
	ErrUserGuideNotFound      error = common.NewMessage("Guide not found")
	ErrUserGuideTitleInvalid  error = common.NewMessage("Guide title must contain 1–128 characters")
	ErrUserGuideContentEmpty  error = common.NewMessage("Guide content cannot be empty")
	ErrUserGuideContentLong   error = common.NewMessage("Guide content cannot exceed 200000 characters")
	ErrUserGuideFormatInvalid error = common.NewMessage("Invalid guide format")
)

// UserGuide 是管理员维护、登录用户阅读的使用说明文档。
type UserGuide struct {
	Id          int      `json:"id"`
	Title       string   `json:"title" gorm:"type:varchar(128);not null"`
	Format      string   `json:"format" gorm:"type:varchar(16);not null"`
	Content     LongText `json:"content,omitempty" gorm:"not null"`
	SortOrder   int      `json:"sort_order" gorm:"not null;default:0;index"`
	Enabled     bool     `json:"enabled" gorm:"not null"`
	CreatedTime int64    `json:"created_time" gorm:"bigint"`
	UpdatedTime int64    `json:"updated_time" gorm:"bigint"`
}

// GetUserGuides 列表不带正文，避免一次下发所有长文档。
func GetUserGuides(onlyEnabled bool) ([]UserGuide, error) {
	guides := make([]UserGuide, 0)
	query := DB.Model(&UserGuide{}).Omit("content")
	if onlyEnabled {
		query = query.Where("enabled = ?", true)
	}
	err := query.Order("sort_order asc").Order("id asc").Find(&guides).Error
	return guides, err
}

func GetUserGuide(id int, onlyEnabled bool) (*UserGuide, error) {
	var guide UserGuide
	query := DB.Where("id = ?", id)
	if onlyEnabled {
		query = query.Where("enabled = ?", true)
	}
	err := query.First(&guide).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		err = ErrUserGuideNotFound
	}
	return &guide, err
}

func (guide *UserGuide) Save() error {
	guide.Title = strings.TrimSpace(guide.Title)
	if guide.Title == "" || utf8.RuneCountInString(guide.Title) > userGuideTitleMaxRunes {
		return ErrUserGuideTitleInvalid
	}
	if guide.Format != UserGuideFormatMarkdown && guide.Format != UserGuideFormatHTML {
		return ErrUserGuideFormatInvalid
	}
	if strings.TrimSpace(string(guide.Content)) == "" {
		return ErrUserGuideContentEmpty
	}
	if utf8.RuneCountInString(string(guide.Content)) > userGuideContentMaxRunes {
		return ErrUserGuideContentLong
	}
	guide.UpdatedTime = common.GetTimestamp()
	if guide.Id == 0 {
		guide.CreatedTime = guide.UpdatedTime
		return DB.Create(guide).Error
	}
	// MySQL 对未变化的行返回 0 affected rows，所以先锁行确认存在，再更新。
	return DB.Transaction(func(tx *gorm.DB) error {
		var existing UserGuide
		err := lockForUpdate(tx).Select("id", "created_time").Where("id = ?", guide.Id).First(&existing).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrUserGuideNotFound
		}
		if err != nil {
			return err
		}
		guide.CreatedTime = existing.CreatedTime
		return tx.Model(&UserGuide{}).Where("id = ?", guide.Id).Select("title", "format", "content", "sort_order", "enabled", "updated_time").Updates(guide).Error
	})
}

func DeleteUserGuide(id int) error {
	result := DB.Where("id = ?", id).Delete(&UserGuide{})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrUserGuideNotFound
	}
	return nil
}
