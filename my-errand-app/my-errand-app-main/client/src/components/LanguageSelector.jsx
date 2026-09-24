import React from 'react';
import { useTranslation } from 'react-i18next';
import './LanguageSelector.css';

const LanguageSelector = () => {
    const { i18n } = useTranslation();

    const languages = [
        { code: 'en', name: 'English', flag: '🇺🇸' },
        { code: 'es', name: 'Español', flag: '🇪🇸' },
        { code: 'fr', name: 'Français', flag: '🇫🇷' }
    ];

    const changeLanguage = (languageCode) => {
        i18n.changeLanguage(languageCode);
    };

    return (
        <div className="language-selector">
            <div className="language-dropdown">
                <button className="language-toggle">
                    {languages.find(lang => lang.code === i18n.language)?.flag || '🌐'} 
                    <span className="language-name">
                        {languages.find(lang => lang.code === i18n.language)?.name || 'Language'}
                    </span>
                    <span className="dropdown-arrow">▼</span>
                </button>
                <div className="language-options">
                    {languages.map((language) => (
                        <button
                            key={language.code}
                            onClick={() => changeLanguage(language.code)}
                            className={`language-option ${i18n.language === language.code ? 'active' : ''}`}
                        >
                            <span className="flag">{language.flag}</span>
                            <span className="name">{language.name}</span>
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default LanguageSelector;
