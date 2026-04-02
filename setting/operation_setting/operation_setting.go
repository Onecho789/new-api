package operation_setting

import "strings"

var DemoSiteEnabled = false
var SelfUseModeEnabled = false

var AutomaticDisableKeywords = []string{
	"Your credit balance is too low",
	"This organization has been disabled.",
	"You exceeded your current quota",
	"Permission denied",
	"The security token included in the request is invalid",
	"Operation not allowed",
	"Your account is not authorized",
}

func AutomaticDisableKeywordsToString() string {
	return strings.Join(AutomaticDisableKeywords, "\n")
}

func AutomaticDisableKeywordsFromString(s string) {
	AutomaticDisableKeywords = []string{}
	ak := strings.Split(s, "\n")
	for _, k := range ak {
		k = strings.TrimSpace(k)
		k = strings.ToLower(k)
		if k != "" {
			AutomaticDisableKeywords = append(AutomaticDisableKeywords, k)
		}
	}
}

// ErrorMessageReplacement stores a keyword->replacement mapping rule
type ErrorMessageReplacement struct {
	Keyword     string // match keyword (already lowercased)
	Replacement string // replacement text
}

var ErrorMessageReplacements []ErrorMessageReplacement

func ErrorMessageReplacementsToString() string {
	lines := make([]string, 0, len(ErrorMessageReplacements))
	for _, r := range ErrorMessageReplacements {
		lines = append(lines, r.Keyword+"=>"+r.Replacement)
	}
	return strings.Join(lines, "\n")
}

func ErrorMessageReplacementsFromString(s string) {
	var rules []ErrorMessageReplacement
	for _, line := range strings.Split(s, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		parts := strings.SplitN(line, "=>", 2)
		if len(parts) != 2 {
			continue
		}
		keyword := strings.TrimSpace(parts[0])
		replacement := strings.TrimSpace(parts[1])
		if keyword == "" {
			continue
		}
		rules = append(rules, ErrorMessageReplacement{
			Keyword:     strings.ToLower(keyword),
			Replacement: replacement,
		})
	}
	ErrorMessageReplacements = rules
}

// TranslateErrorMessage checks the message against all replacement rules (case-insensitive).
// Returns the replacement text on first match, or the original message if no match.
func TranslateErrorMessage(message string) string {
	if len(ErrorMessageReplacements) == 0 || message == "" {
		return message
	}
	lowerMsg := strings.ToLower(message)
	for _, r := range ErrorMessageReplacements {
		if strings.Contains(lowerMsg, r.Keyword) {
			return r.Replacement
		}
	}
	return message
}
