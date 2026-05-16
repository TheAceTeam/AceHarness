'use client';

import { useState, useEffect, useCallback } from 'react';
import enMessages from '../../messages/en.json';
import zhMessages from '../../messages/zh.json';

type Locale = 'zh' | 'en';

const LOCALE_STORAGE_KEY = 'locale';

const messages: Record<Locale, any> = {
  en: enMessages,
  zh: zhMessages,
};

function normalizeLocale(value: unknown): Locale {
  return value === 'en' ? 'en' : 'zh';
}

function getStoredLocale(): Locale {
  return normalizeLocale(localStorage.getItem(LOCALE_STORAGE_KEY) || document.documentElement.lang || 'zh');
}

function applyLocale(locale: Locale) {
  localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  document.documentElement.lang = locale === 'en' ? 'en' : 'zh-CN';
}

export function useTranslations() {
  const [locale, setLocale] = useState<Locale>('zh');

  useEffect(() => {
    const saved = getStoredLocale();
    applyLocale(saved);
    setLocale(saved);

    const handleStorage = (event: StorageEvent) => {
      if (event.key === LOCALE_STORAGE_KEY && (event.newValue === 'en' || event.newValue === 'zh')) {
        setLocale(event.newValue);
        applyLocale(event.newValue);
      }
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const t = useCallback((key: string): string => {
    const keys = key.split('.');
    let value: any = messages[locale];

    for (const k of keys) {
      value = value?.[k];
    }

    return value || key;
  }, [locale]);

  return { t, locale };
}
