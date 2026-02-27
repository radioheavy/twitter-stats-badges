(function () {
    'use strict';

    // ── Config ──────────────────────────────────────────────
    const CACHE_TTL = 10 * 60 * 1000; // 10 dakika cache
    const BATCH_DELAY = 300;
    const DEBUG = true; // ilk kurulumda açık bırak, sonra false yap
    const ENABLE_CREDIBILITY_DNA = true; // özellik #2
    const ENABLE_RAID_RADAR = true; // özellik #3
    const RAID_SCAN_INTERVAL = 15 * 1000;
    const RAID_MIN_SAMPLE = 8;
    const RAID_MAX_SAMPLE = 24;

    // ── Cache ───────────────────────────────────────────────
    const userCache = new Map();
    const inflightRequests = new Map();

    // ── Helpers ─────────────────────────────────────────────
    function log(...args) {
        if (DEBUG) console.log('%c[TW-Stats]', 'color: #1d9bf0; font-weight: bold', ...args);
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
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

    function getAccountAgeDays(dateStr) {
        const createdAt = new Date(dateStr).getTime();
        const ms = Date.now() - createdAt;
        return Math.max(1, Math.floor(ms / (1000 * 60 * 60 * 24)));
    }

    function formatAgeShort(days) {
        if (days >= 365) return `${Math.floor(days / 365)}y`;
        if (days >= 30) return `${Math.floor(days / 30)}ay`;
        return `${days}g`;
    }

    function formatRatio(ratio) {
        if (!Number.isFinite(ratio)) return '0';
        return ratio.toFixed(2).replace(/\.00$/, '');
    }

    function toMonthKey(dateStr) {
        const d = new Date(dateStr);
        if (Number.isNaN(d.getTime())) return 'unknown';
        const month = String(d.getMonth() + 1).padStart(2, '0');
        return `${d.getFullYear()}-${month}`;
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
        const cacheKey = screenName.toLowerCase();

        // Cache kontrol
        const cached = userCache.get(cacheKey);
        if (cached && Date.now() - cached.ts < CACHE_TTL) {
            log('📦 Cache:', screenName);
            return cached.data;
        }

        // Aynı kullanıcı için paralel istekleri tek istekte birleştir
        if (inflightRequests.has(cacheKey)) {
            return inflightRequests.get(cacheKey);
        }

        const requestPromise = (async () => {
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
                        await sleep(60000);
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
                    userCache.set(cacheKey, { data: null, ts: Date.now() });
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
                    is_blue_verified: Boolean(userResult.is_blue_verified),
                    verified: Boolean(user.verified),
                    default_profile_image: Boolean(user.default_profile_image),
                    favourites_count: user.favourites_count || 0,
                };

                userCache.set(cacheKey, { data, ts: Date.now() });
                log('✅ OK:', screenName, `(${formatNumber(data.followers_count)} takipçi)`);
                return data;

            } catch (err) {
                log('💥 Hata:', screenName, err.message);
                return null;
            }
        })();

        inflightRequests.set(cacheKey, requestPromise);

        try {
            return await requestPromise;
        } finally {
            inflightRequests.delete(cacheKey);
        }
    }

    // ── Credibility DNA (özellik #2) ───────────────────────
    function calculateCredibilityDNA(userData) {
        const ageDays = getAccountAgeDays(userData.created_at);
        const tweetsPerDay = userData.statuses_count / Math.max(ageDays, 1);
        const followRatio = userData.followers_count / Math.max(userData.friends_count, 1);

        // Hesap yaşı: en yüksek ağırlık
        const ageScore = clamp(
            (Math.log10(ageDays + 1) / Math.log10(3650 + 1)) * 30,
            0,
            30
        );

        // Ağ yapısı: takipçi miktarı + takipçi/takip dengesi
        const followerScore = clamp((Math.log10(userData.followers_count + 1) / 6) * 15, 0, 15);
        const ratioBalance = 10 - Math.min(10, Math.abs(Math.log10(followRatio + 1) - 0.3) * 6);
        const networkScore = followerScore + clamp(ratioBalance, 0, 10);

        // Aktivite: çok düşük veya aşırı yüksek hızları kırp
        const activityBaseline = 25 - Math.abs(Math.log10(tweetsPerDay + 0.1) - 1) * 10;
        const activityScore = clamp(activityBaseline, 0, 25);

        // Profil sinyalleri
        const profileScore =
            (userData.is_blue_verified ? 5 : 0) +
            (userData.verified ? 3 : 0) +
            (!userData.default_profile_image ? 6 : 0) +
            (userData.followers_count >= 50 ? 3 : 0) +
            (userData.statuses_count >= 100 ? 3 : 0);

        // Anormallik cezaları
        let penalty = 0;
        if (ageDays < 30 && userData.statuses_count > 1200) penalty += 12;
        if (tweetsPerDay > 300) penalty += 10;
        if (followRatio < 0.03 && userData.friends_count > 500) penalty += 8;

        const rawScore = ageScore + networkScore + activityScore + profileScore - penalty;
        const score = Math.round(clamp(rawScore, 0, 100));

        let label = 'Düşük';
        if (score >= 75) label = 'Güçlü';
        else if (score >= 50) label = 'Orta';

        return {
            score,
            label,
            ageDays,
            tweetsPerDay,
            followRatio,
        };
    }

    function getDnaBadgeColor(score) {
        if (score >= 75) return 'rgba(34, 197, 94, 0.85)';
        if (score >= 50) return 'rgba(245, 158, 11, 0.85)';
        return 'rgba(239, 68, 68, 0.85)';
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

        // 🧬 Credibility DNA
        if (ENABLE_CREDIBILITY_DNA) {
            const dna = calculateCredibilityDNA(userData);
            container.appendChild(createBadge(
                '🧬', String(dna.score),
                getDnaBadgeColor(dna.score),
                `Credibility DNA: ${dna.score}/100 (${dna.label}) • Hesap yaşı: ${formatAgeShort(dna.ageDays)} • Tweet/gün: ${dna.tweetsPerDay.toFixed(1)} • Takipçi/Takip: ${formatRatio(dna.followRatio)}`
            ));
        }

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

    // ── Raid Radar (özellik #3) ─────────────────────────────
    let raidRadarProcessing = false;
    let lastRaidRunTs = 0;
    let raidIntervalId = null;

    function isStatusPage() {
        return /\/status\/\d+/.test(location.pathname);
    }

    function extractScreenNameFromStatusHref(href) {
        const match = href.match(/^\/([^/?#]+)\/status\/\d+/);
        return match ? match[1] : null;
    }

    function getTweetAuthorFromArticle(article) {
        const statusLink = article.querySelector('a[href*="/status/"]');
        if (!statusLink) return null;
        const href = statusLink.getAttribute('href') || '';
        return extractScreenNameFromStatusHref(href);
    }

    function collectReplyAuthors() {
        const tweetArticles = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
        if (tweetArticles.length === 0) return [];

        const primaryAuthor = (getTweetAuthorFromArticle(tweetArticles[0]) || '').toLowerCase();
        const seen = new Set();
        const authors = [];

        for (let i = 1; i < tweetArticles.length && authors.length < RAID_MAX_SAMPLE; i++) {
            const author = getTweetAuthorFromArticle(tweetArticles[i]);
            if (!author) continue;

            const lower = author.toLowerCase();
            if (!lower) continue;
            if (lower === primaryAuthor) continue;
            if (IGNORED_PATHS.has(lower)) continue;
            if (seen.has(lower)) continue;

            seen.add(lower);
            authors.push(author);
        }

        return authors;
    }

    function analyzeRaidSample(users) {
        const total = users.length;
        if (total < RAID_MIN_SAMPLE) return null;

        const details = users.map(user => {
            const dna = calculateCredibilityDNA(user);
            const ageDays = getAccountAgeDays(user.created_at);
            return {
                dnaScore: dna.score,
                ageDays,
                followers: user.followers_count,
                monthKey: toMonthKey(user.created_at),
            };
        });

        const newAccounts = details.filter(d => d.ageDays < 45).length;
        const veryNewAccounts = details.filter(d => d.ageDays < 14).length;
        const lowDna = details.filter(d => d.dnaScore < 40).length;
        const lowFollowers = details.filter(d => d.followers < 30).length;
        const avgDna = Math.round(details.reduce((sum, d) => sum + d.dnaScore, 0) / total);

        const monthCounts = new Map();
        details.forEach(d => {
            monthCounts.set(d.monthKey, (monthCounts.get(d.monthKey) || 0) + 1);
        });

        let clusterMonth = '-';
        let clusterCount = 0;
        for (const [month, count] of monthCounts.entries()) {
            if (count > clusterCount) {
                clusterMonth = month;
                clusterCount = count;
            }
        }

        const clusterRate = clusterCount / total;
        const hasClusterSignal = clusterCount >= 4 && clusterRate >= 0.45;

        const raidScore = Math.round(clamp(
            (newAccounts / total) * 40 +
            (veryNewAccounts / total) * 20 +
            (lowDna / total) * 30 +
            (lowFollowers / total) * 10 +
            (hasClusterSignal ? 10 : 0),
            0,
            100
        ));

        let risk = 'clean';
        let riskLabel = 'Temiz';
        if (raidScore >= 70) {
            risk = 'high';
            riskLabel = 'Yüksek';
        } else if (raidScore >= 50) {
            risk = 'medium';
            riskLabel = 'Orta';
        } else if (raidScore >= 35) {
            risk = 'watch';
            riskLabel = 'İzlemede';
        }

        return {
            total,
            raidScore,
            risk,
            riskLabel,
            avgDna,
            newAccounts,
            lowDna,
            clusterMonth,
            clusterCount,
            hasClusterSignal,
        };
    }

    function removeRaidRadarPanel() {
        const panel = document.getElementById('tw-raid-radar');
        if (panel) panel.remove();
    }

    function renderRaidRadarPanel(summary) {
        if (!summary) {
            removeRaidRadarPanel();
            return;
        }

        let panel = document.getElementById('tw-raid-radar');
        if (!panel) {
            panel = document.createElement('aside');
            panel.id = 'tw-raid-radar';
            panel.innerHTML = `
                <div class="tw-raid-radar__title"></div>
                <div class="tw-raid-radar__meta"></div>
                <div class="tw-raid-radar__cluster"></div>
            `;
            document.body.appendChild(panel);
        }

        panel.setAttribute('data-risk', summary.risk);

        const titleEl = panel.querySelector('.tw-raid-radar__title');
        const metaEl = panel.querySelector('.tw-raid-radar__meta');
        const clusterEl = panel.querySelector('.tw-raid-radar__cluster');
        if (!titleEl || !metaEl || !clusterEl) return;

        titleEl.textContent = `🛡️ Raid Radar: ${summary.riskLabel} risk (${summary.raidScore}/100)`;
        metaEl.textContent = `Örnek: ${summary.total} hesap • Yeni hesap: ${summary.newAccounts}/${summary.total} • Düşük DNA: ${summary.lowDna}/${summary.total} • Ort. DNA: ${summary.avgDna}`;
        clusterEl.textContent = summary.hasClusterSignal
            ? `Küme sinyali: ${summary.clusterMonth} döneminde ${summary.clusterCount} hesap`
            : 'Küme sinyali: belirgin açılış dönemi kümelenmesi yok';
    }

    async function processRaidRadar(force = false) {
        if (!ENABLE_RAID_RADAR) return;
        if (raidRadarProcessing) return;

        const now = Date.now();
        if (!force && now - lastRaidRunTs < RAID_SCAN_INTERVAL - 300) return;
        lastRaidRunTs = now;

        raidRadarProcessing = true;
        try {
            if (!isStatusPage()) {
                removeRaidRadarPanel();
                return;
            }

            const authors = collectReplyAuthors();
            if (authors.length < RAID_MIN_SAMPLE) {
                removeRaidRadarPanel();
                return;
            }

            const users = [];
            for (const screenName of authors) {
                const data = await fetchUserByScreenName(screenName);
                if (data) users.push(data);
                await sleep(80);
            }

            const summary = analyzeRaidSample(users);
            renderRaidRadarPanel(summary);

            if (summary) {
                log(`🛡️ Raid Radar: ${summary.riskLabel} (${summary.raidScore})`);
            }
        } catch (err) {
            log('💥 Raid Radar hatası:', err);
        } finally {
            raidRadarProcessing = false;
        }
    }

    function startRaidRadar() {
        if (!ENABLE_RAID_RADAR) return;
        if (raidIntervalId) clearInterval(raidIntervalId);
        raidIntervalId = setInterval(() => processRaidRadar(false), RAID_SCAN_INTERVAL);
    }

    // ── Global CSS ──────────────────────────────────────────
    function injectStyles() {
        const style = document.createElement('style');
        style.textContent = `
            @keyframes twStatsFadeIn {
                from { opacity: 0; transform: translateY(-2px); }
                to { opacity: 1; transform: translateY(0); }
            }

            #tw-raid-radar {
                position: fixed;
                right: 14px;
                bottom: 14px;
                z-index: 2147483647;
                width: min(380px, calc(100vw - 28px));
                border-radius: 14px;
                padding: 10px 12px;
                backdrop-filter: blur(8px);
                box-shadow: 0 10px 30px rgba(0, 0, 0, 0.28);
                color: #fff;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                border: 1px solid rgba(255, 255, 255, 0.2);
                pointer-events: none;
                animation: twStatsFadeIn 0.3s ease-in;
            }

            #tw-raid-radar[data-risk="high"] { background: rgba(220, 38, 38, 0.92); }
            #tw-raid-radar[data-risk="medium"] { background: rgba(217, 119, 6, 0.92); }
            #tw-raid-radar[data-risk="watch"] { background: rgba(2, 132, 199, 0.9); }
            #tw-raid-radar[data-risk="clean"] { background: rgba(22, 163, 74, 0.88); }

            .tw-raid-radar__title {
                font-size: 13px;
                font-weight: 700;
                line-height: 1.25;
                margin-bottom: 4px;
            }

            .tw-raid-radar__meta,
            .tw-raid-radar__cluster {
                font-size: 11px;
                line-height: 1.4;
                opacity: 0.96;
            }
        `;
        document.head.appendChild(style);
    }

    // ── Observer ────────────────────────────────────────────
    let debounceTimer = null;

    function startObserver() {
        const observer = new MutationObserver(() => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                processUserLinks();
                processRaidRadar(false);
            }, 600);
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
        });

        log('👁️ MutationObserver başlatıldı');
    }

    // ── Init ────────────────────────────────────────────────
    function init() {
        log('🚀 Twitter Stats Badges v1.1 başlatılıyor...');
        injectStyles();

        // Sayfa yüklendikten sonra biraz bekle
        setTimeout(() => {
            processUserLinks();
            processRaidRadar(true);
            startObserver();
            startRaidRadar();
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
