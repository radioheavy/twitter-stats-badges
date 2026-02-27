(function () {
    'use strict';

    // ── Config ──────────────────────────────────────────────
    const CACHE_TTL = 10 * 60 * 1000; // 10 dakika cache
    const BATCH_DELAY = 300;
    const DEBUG = true; // ilk kurulumda açık bırak, sonra false yap

    // ── Cache ───────────────────────────────────────────────
    const userCache = new Map();

    // ── Helpers ─────────────────────────────────────────────
    function log(...args) {
        if (DEBUG) console.log('%c[TW-Stats]', 'color: #1d9bf0; font-weight: bold', ...args);
    }

    function formatNumber(num) {
        if (num >= 1_000_000) return (num / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
        if (num >= 1_000) return (num / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
        return String(num);
    }

    function formatDate(dateStr) {
        const date = new Date(dateStr);
        const months = {
            0: 'Oca', 1: 'Şub', 2: 'Mar', 3: 'Nis', 4: 'May', 5: 'Haz',
            6: 'Tem', 7: 'Ağu', 8: 'Eyl', 9: 'Eki', 10: 'Kas', 11: 'Ara'
        };
        return `${months[date.getMonth()]} ${date.getFullYear()}`;
    }

    // ── Sayfalardan yoksul kullanıcıları filtrele ───────────
    const IGNORED_PATHS = new Set([
        'home', 'explore', 'notifications', 'messages', 'settings',
        'search', 'compose', 'login', 'signup', 'i', 'tos', 'privacy',
        'hashtag', 'intent', 'account', 'who_to_follow'
    ]);

    // ── Twitter Internal API ────────────────────────────────
    function getCsrfToken() {
        const match = document.cookie.match(/ct0=([^;]+)/);
        return match ? match[1] : null;
    }

    function getAuthHeaders() {
        const ct0 = getCsrfToken();
        if (!ct0) {
            log('⚠️ ct0 token bulunamadı - giriş yapılmamış olabilir');
            return null;
        }

        return {
            'authorization': 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA',
            'x-csrf-token': ct0,
            'x-twitter-auth-type': 'OAuth2Session',
            'x-twitter-active-user': 'yes',
            'x-twitter-client-language': navigator.language || 'tr',
        };
    }

    async function fetchUserByScreenName(screenName) {
        // Cache kontrol
        const cached = userCache.get(screenName.toLowerCase());
        if (cached && Date.now() - cached.ts < CACHE_TTL) {
            log('📦 Cache:', screenName);
            return cached.data;
        }

        const headers = getAuthHeaders();
        if (!headers) return null;

        try {
            const variables = JSON.stringify({
                screen_name: screenName,
                withSafetyModeUserFields: true
            });

            const features = JSON.stringify({
                hidden_profile_subscriptions_enabled: true,
                rweb_tipjar_consumption_enabled: true,
                responsive_web_graphql_exclude_directive_enabled: true,
                verified_phone_label_enabled: false,
                subscriptions_verification_info_is_identity_verified_enabled: true,
                subscriptions_verification_info_verified_since_enabled: true,
                highlights_tweets_tab_ui_enabled: true,
                responsive_web_twitter_article_notes_tab_enabled: true,
                subscriptions_feature_can_gift_premium: true,
                creator_subscriptions_tweet_preview_api_enabled: true,
                responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
                responsive_web_graphql_timeline_navigation_enabled: true,
            });

            const fieldToggles = JSON.stringify({ withAuxiliaryUserLabels: false });

            const url = `https://x.com/i/api/graphql/xc8f1g7BYqr6VTzTbvNlGw/UserByScreenName?variables=${encodeURIComponent(variables)}&features=${encodeURIComponent(features)}&fieldToggles=${encodeURIComponent(fieldToggles)}`;

            log('🔍 Fetching:', screenName);
            const resp = await fetch(url, { headers, credentials: 'include' });

            if (!resp.ok) {
                if (resp.status === 429) {
                    log('🚫 Rate limited! 60s bekleniyor...');
                    await new Promise(r => setTimeout(r, 60000));
                } else {
                    log('❌ API hata:', resp.status, screenName);
                }
                return null;
            }

            const json = await resp.json();
            const userResult = json?.data?.user?.result;

            if (!userResult || userResult.__typename === 'UserUnavailable') {
                log('❌ Kullanıcı bulunamadı:', screenName);
                // Yine de cache'e koy ki tekrar sorgulamasın
                userCache.set(screenName.toLowerCase(), { data: null, ts: Date.now() });
                return null;
            }

            const user = userResult.legacy;
            const data = {
                id: userResult.rest_id,
                name: user.name,
                screen_name: user.screen_name,
                followers_count: user.followers_count,
                friends_count: user.friends_count,
                statuses_count: user.statuses_count,
                created_at: user.created_at,
                is_blue_verified: userResult.is_blue_verified,
            };

            userCache.set(screenName.toLowerCase(), { data, ts: Date.now() });
            log('✅ OK:', screenName, `(${formatNumber(data.followers_count)} takipçi)`);
            return data;

        } catch (err) {
            log('💥 Hata:', screenName, err.message);
            return null;
        }
    }

    // ── Badge Oluşturma ─────────────────────────────────────
    function createBadge(emoji, text, bgColor, title) {
        const badge = document.createElement('span');
        badge.className = 'tw-stats-badge';
        badge.title = title;
        badge.textContent = `${emoji} ${text}`;
        Object.assign(badge.style, {
            display: 'inline-flex',
            alignItems: 'center',
            gap: '2px',
            padding: '0px 5px',
            borderRadius: '9999px',
            fontSize: '11px',
            fontWeight: '500',
            lineHeight: '18px',
            background: bgColor,
            color: '#ffffff',
            marginLeft: '3px',
            whiteSpace: 'nowrap',
            verticalAlign: 'middle',
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            cursor: 'default',
            transition: 'filter 0.15s',
        });
        badge.addEventListener('mouseenter', () => badge.style.filter = 'brightness(1.3)');
        badge.addEventListener('mouseleave', () => badge.style.filter = 'brightness(1)');
        return badge;
    }

    function createStatsContainer(userData) {
        const container = document.createElement('span');
        container.className = 'tw-stats-container';
        Object.assign(container.style, {
            display: 'inline-flex',
            alignItems: 'center',
            gap: '3px',
            marginLeft: '4px',
            flexShrink: '0',
            animation: 'twStatsFadeIn 0.3s ease-in',
        });

        // 📝 Tweet sayısı
        container.appendChild(createBadge(
            '📝', formatNumber(userData.statuses_count),
            'rgba(249, 115, 22, 0.8)',
            `${userData.statuses_count.toLocaleString('tr-TR')} tweet`
        ));

        // 👥 Takipçi
        container.appendChild(createBadge(
            '→', formatNumber(userData.followers_count),
            'rgba(59, 130, 246, 0.8)',
            `${userData.followers_count.toLocaleString('tr-TR')} takipçi`
        ));

        // 📅 Katılım tarihi
        container.appendChild(createBadge(
            '📅', formatDate(userData.created_at),
            'rgba(34, 197, 94, 0.8)',
            `Katılım: ${new Date(userData.created_at).toLocaleDateString('tr-TR')}`
        ));

        return container;
    }

    // ── DOM İşleme ──────────────────────────────────────────
    const processingQueue = new Set();

    function findUserLinks() {
        const links = document.querySelectorAll('a[role="link"][href^="/"]');
        const results = [];

        links.forEach(link => {
            const href = link.getAttribute('href');
            if (!href) return;

            // /username formatını kontrol et
            const parts = href.split('/').filter(Boolean);
            if (parts.length !== 1) return;

            const screenName = parts[0];
            if (IGNORED_PATHS.has(screenName.toLowerCase())) return;

            // @ ile başlayan text mi?
            const text = link.textContent.trim();
            if (!text.startsWith('@')) return;
            if (text.substring(1).toLowerCase() !== screenName.toLowerCase()) return;

            // Zaten badge var mı?
            const parent = link.closest('div') || link.parentElement;
            if (!parent) return;
            if (parent.querySelector('.tw-stats-container')) return;

            // Queue'da mı?
            const key = `${screenName}-${link.getBoundingClientRect().top}`;
            if (processingQueue.has(key)) return;

            results.push({ element: link, screenName, key });
        });

        return results;
    }

    let isProcessing = false;

    async function processUserLinks() {
        if (isProcessing) return;
        isProcessing = true;

        try {
            const links = findUserLinks();
            if (links.length > 0) {
                log(`🔎 ${links.length} kullanıcı bulundu`);
            }

            for (const { element, screenName, key } of links) {
                processingQueue.add(key);

                // Element hala DOM'da mı?
                if (!document.contains(element)) continue;

                const userData = await fetchUserByScreenName(screenName);
                if (!userData) continue;

                // Tekrar kontrol - arada eklenmiş olabilir
                const parent = element.closest('div') || element.parentElement;
                if (!parent || parent.querySelector('.tw-stats-container')) continue;

                const stats = createStatsContainer(userData);

                // @ linkinin yanına ekle
                if (element.nextSibling) {
                    element.parentNode.insertBefore(stats, element.nextSibling);
                } else {
                    element.parentNode.appendChild(stats);
                }

                // Rate limit koruması
                await new Promise(r => setTimeout(r, BATCH_DELAY));
            }
        } catch (err) {
            log('💥 Process hatası:', err);
        }

        isProcessing = false;
    }

    // ── Global CSS ──────────────────────────────────────────
    function injectStyles() {
        const style = document.createElement('style');
        style.textContent = `
            @keyframes twStatsFadeIn {
                from { opacity: 0; transform: translateY(-2px); }
                to { opacity: 1; transform: translateY(0); }
            }
        `;
        document.head.appendChild(style);
    }

    // ── Observer ────────────────────────────────────────────
    let debounceTimer = null;

    function startObserver() {
        const observer = new MutationObserver(() => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(processUserLinks, 600);
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
        });

        log('👁️ MutationObserver başlatıldı');
    }

    // ── Init ────────────────────────────────────────────────
    function init() {
        log('🚀 Twitter Stats Badges v1.0 başlatılıyor...');
        injectStyles();

        // Sayfa yüklendikten sonra biraz bekle
        setTimeout(() => {
            processUserLinks();
            startObserver();
            log('✅ Hazır!');
        }, 2500);
    }

    // Başlat
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        init();
    } else {
        window.addEventListener('DOMContentLoaded', init);
    }

})();
