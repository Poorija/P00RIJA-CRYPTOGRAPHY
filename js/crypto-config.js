/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

(function (global) {
    const SAFE_ALGORITHMS = [
        {
            id: 'AES-256-GCM',
            family: 'symmetric',
            mode: 'AES-GCM',
            keyLengthBits: 256,
            ivLength: 12,
            authenticated: true,
            recommended: true,
            label: {
                fa: 'AES-256-GCM (پیشنهادی)',
                en: 'AES-256-GCM (Recommended)'
            },
            detail: {
                fa: 'رمزنگاری متقارن AEAD؛ بهترین انتخاب عمومی برای وب کلاینت‌ساید.',
                en: 'Symmetric AEAD; the best general-purpose client-side web choice.'
            }
        },
        {
            id: 'AES-192-GCM',
            family: 'symmetric',
            mode: 'AES-GCM',
            keyLengthBits: 192,
            ivLength: 12,
            authenticated: true,
            label: {
                fa: 'AES-192-GCM',
                en: 'AES-192-GCM'
            },
            detail: {
                fa: 'نسخه 192 بیتی GCM برای سازگاری و سیاست‌های خاص.',
                en: '192-bit GCM variant for compatibility and specific policy needs.'
            }
        },
        {
            id: 'AES-128-GCM',
            family: 'symmetric',
            mode: 'AES-GCM',
            keyLengthBits: 128,
            ivLength: 12,
            authenticated: true,
            label: {
                fa: 'AES-128-GCM',
                en: 'AES-128-GCM'
            },
            detail: {
                fa: 'سریع‌تر و سبک‌تر، با امنیت بسیار خوب برای سناریوهای عمومی.',
                en: 'Smaller and faster, with strong security for general scenarios.'
            }
        },
        {
            id: 'XCHACHA20-POLY1305',
            family: 'symmetric',
            mode: 'XCHACHA20-POLY1305',
            keyLengthBits: 256,
            ivLength: 24,
            authenticated: true,
            software: true,
            label: {
                fa: 'XChaCha20-Poly1305',
                en: 'XChaCha20-Poly1305'
            },
            detail: {
                fa: 'AEAD نرم\u200cافزاری با nonce ۱۹۲ بیتی؛ بدون وابستگی به AES-NI و بدون خطر تکرار nonce.',
                en: 'Software AEAD with a 192-bit nonce: no AES-NI dependency and no nonce-reuse risk.'
            }
        },
        {
            id: 'RSA-OAEP-3072',
            family: 'hybrid-rsa',
            mode: 'RSA-OAEP',
            keyLengthBits: 3072,
            hash: 'SHA-256',
            contentAlgorithm: 'AES-256-GCM',
            contentKeyLengthBits: 256,
            contentIvLength: 12,
            recommended: true,
            label: {
                fa: 'RSA-OAEP-3072 + AES-256-GCM (هیبرید)',
                en: 'RSA-OAEP-3072 + AES-256-GCM (Hybrid)'
            },
            detail: {
                fa: 'کلید عمومی برای رمزکردن کلید نشست AES؛ انتخاب قوی و سازگار برای وب.',
                en: 'Public-key wrapping of an AES session key; strong and broadly compatible for the web.'
            }
        },
        {
            id: 'RSA-OAEP-4096',
            family: 'hybrid-rsa',
            mode: 'RSA-OAEP',
            keyLengthBits: 4096,
            hash: 'SHA-256',
            contentAlgorithm: 'AES-256-GCM',
            contentKeyLengthBits: 256,
            contentIvLength: 12,
            heavier: true,
            label: {
                fa: 'RSA-OAEP-4096 + AES-256-GCM (هیبرید، سنگین‌تر)',
                en: 'RSA-OAEP-4096 + AES-256-GCM (Hybrid, heavier)'
            },
            detail: {
                fa: 'امن و سنگین‌تر از 3072؛ برای زمانی که هزینه‌ی پردازشی مهم نیست.',
                en: 'Stronger and heavier than 3072; useful when extra cost is acceptable.'
            }
        }
    ];

    /* Deliberately empty.

       This array used to carry RC4, TripleDES, Rabbit, AES-CFB and AES-OFB,
       routed through CryptoJS. RC4 is broken, TripleDES is retired (Sweet32),
       and CFB and OFB are unauthenticated — a chooser that offers them is a
       chooser that invites the worst option in it. They were kept for
       "compatibility" with data this application has never shipped to anyone,
       so there was nothing to be compatible with.

       It stays as an empty export rather than disappearing so callers keep
       working and so this note has somewhere to live. Nothing may be added
       here: an algorithm either belongs in SAFE_ALGORITHMS or nowhere. */
    const LEGACY_ALGORITHMS = [];

    const ALL_ALGORITHMS = SAFE_ALGORITHMS.concat(LEGACY_ALGORITHMS);
    const BY_ID = Object.fromEntries(ALL_ALGORITHMS.map((algorithm) => [algorithm.id, algorithm]));

    function getAlgorithmConfig(id) {
        return BY_ID[id] || SAFE_ALGORITHMS[0];
    }

    function getSafeAlgorithms() {
        return SAFE_ALGORITHMS.slice();
    }

    function getLegacyAlgorithms() {
        return LEGACY_ALGORITHMS.slice();
    }

    function isLegacyAlgorithm(id) {
        return Boolean(BY_ID[id] && BY_ID[id].legacyOnly);
    }

    function isSymmetricAlgorithm(id) {
        return getAlgorithmConfig(id).family === 'symmetric';
    }

    function isRsaHybridAlgorithm(id) {
        return getAlgorithmConfig(id).family === 'hybrid-rsa';
    }

    function getAlgorithmKeyKind(id) {
        return isSymmetricAlgorithm(id) ? 'secret' : 'keypair';
    }

    function getSymmetricKeyLengthBytes(id) {
        const config = getAlgorithmConfig(id);
        return config.keyLengthBits ? config.keyLengthBits / 8 : null;
    }

    function getAlgorithmOptionList(options) {
        const settings = options || {};
        return settings.includeLegacy ? ALL_ALGORITHMS.slice() : SAFE_ALGORITHMS.slice();
    }

    function getAlgorithmLabel(id, language) {
        const config = getAlgorithmConfig(id);
        return (config.label && config.label[language]) || config.id;
    }

    function buildAlgorithmOptionMarkup(language, options) {
        return getAlgorithmOptionList(options).map((algorithm) => {
            return `<option value="${algorithm.id}">${getAlgorithmLabel(algorithm.id, language)}</option>`;
        }).join('');
    }

    const api = {
        SAFE_ALGORITHMS,
        LEGACY_ALGORITHMS,
        getAlgorithmConfig,
        getSafeAlgorithms,
        getLegacyAlgorithms,
        isLegacyAlgorithm,
        isSymmetricAlgorithm,
        isRsaHybridAlgorithm,
        getAlgorithmKeyKind,
        getSymmetricKeyLengthBytes,
        getAlgorithmOptionList,
        getAlgorithmLabel,
        buildAlgorithmOptionMarkup
    };

    global.PoorijaCryptoConfig = api;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
}(typeof window !== 'undefined' ? window : globalThis));
