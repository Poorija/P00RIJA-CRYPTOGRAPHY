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
            id: 'AES-256-CTR',
            family: 'symmetric',
            mode: 'AES-CTR',
            keyLengthBits: 256,
            ivLength: 16,
            label: {
                fa: 'AES-256-CTR (استریم)',
                en: 'AES-256-CTR (Streaming)'
            },
            detail: {
                fa: 'برای جریان داده؛ بدون اصالت‌سنجی داخلی، پس فقط در مواقع لازم.',
                en: 'Streaming-friendly; no built-in authenticity, so use only when needed.'
            }
        },
        {
            id: 'AES-192-CTR',
            family: 'symmetric',
            mode: 'AES-CTR',
            keyLengthBits: 192,
            ivLength: 16,
            label: {
                fa: 'AES-192-CTR (استریم)',
                en: 'AES-192-CTR (Streaming)'
            },
            detail: {
                fa: 'CTR با کلید 192 بیتی برای سازگاری خاص.',
                en: '192-bit CTR variant for specific compatibility needs.'
            }
        },
        {
            id: 'AES-128-CTR',
            family: 'symmetric',
            mode: 'AES-CTR',
            keyLengthBits: 128,
            ivLength: 16,
            label: {
                fa: 'AES-128-CTR (استریم)',
                en: 'AES-128-CTR (Streaming)'
            },
            detail: {
                fa: 'CTR سبک‌تر برای محیط‌های محدودتر.',
                en: 'Lighter CTR option for more constrained environments.'
            }
        },
        {
            id: 'AES-256-CBC',
            family: 'symmetric',
            mode: 'AES-CBC',
            keyLengthBits: 256,
            ivLength: 16,
            compatibilityOnly: true,
            label: {
                fa: 'AES-256-CBC (سازگاری قدیمی)',
                en: 'AES-256-CBC (Legacy compatibility)'
            },
            detail: {
                fa: 'فقط برای سازگاری با داده‌های قدیمی؛ GCM ارجح است.',
                en: 'For legacy compatibility only; GCM remains preferable.'
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

    const LEGACY_ALGORITHMS = [
        {
            id: 'RSA-OAEP',
            family: 'hybrid-rsa',
            mode: 'RSA-OAEP',
            keyLengthBits: 2048,
            hash: 'SHA-256',
            contentAlgorithm: 'AES-256-GCM',
            contentKeyLengthBits: 256,
            contentIvLength: 12,
            legacyOnly: true,
            label: {
                fa: 'RSA-OAEP (قدیمی)',
                en: 'RSA-OAEP (Legacy)'
            }
        },
        {
            id: 'AES-256-CFB *',
            family: 'legacy-cryptojs',
            legacyOnly: true,
            label: { fa: 'AES-256-CFB *', en: 'AES-256-CFB *' }
        },
        {
            id: 'AES-256-OFB *',
            family: 'legacy-cryptojs',
            legacyOnly: true,
            label: { fa: 'AES-256-OFB *', en: 'AES-256-OFB *' }
        },
        {
            id: 'Rabbit *',
            family: 'legacy-cryptojs',
            legacyOnly: true,
            label: { fa: 'Rabbit *', en: 'Rabbit *' }
        },
        {
            id: '3DES *',
            family: 'legacy-cryptojs',
            legacyOnly: true,
            label: { fa: '3DES *', en: '3DES *' }
        },
        {
            id: 'RC4 *',
            family: 'legacy-cryptojs',
            legacyOnly: true,
            label: { fa: 'RC4 *', en: 'RC4 *' }
        }
    ];

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
