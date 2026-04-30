import { useLanguage } from "../../i18n/LanguageContext";
import "../../styles/components/LanguageSelector.css";

function LanguageSelector({ className = "" }) {
  const { language, options, setLanguage, t } = useLanguage();

  return (
    <div className={`language-selector ${className}`.trim()} role="group" aria-label={t("account.language")}>
      <span className="language-selector__label">{t("account.language")}</span>
      <div className="language-selector__options">
        {options.map((option) => (
          <button
            key={option.code}
            type="button"
            className={`language-selector__option ${language === option.code ? "is-active" : ""}`.trim()}
            aria-pressed={language === option.code}
            onClick={(event) => {
              event.stopPropagation();
              setLanguage(option.code);
            }}
          >
            <span aria-hidden="true">{option.flag}</span>
            <strong>{option.label}</strong>
          </button>
        ))}
      </div>
    </div>
  );
}

export default LanguageSelector;
