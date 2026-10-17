// --- Global .webp Auto-Fallback (Loads .webp first, falls back to .png if missing) ---
window.addEventListener('error', (e) => {
    if (e.target && e.target.tagName === 'IMG' && e.target.src && e.target.src.endsWith('.webp')) {
        e.target.src = e.target.src.replace(/\.webp$/, '.png');
    }
}, true);

// --- Global Accessibility & Ease-of-Use Modal Manager (Click Outside + Escape Key) ---
function closeOverlayModal(overlayEl) {
    if (!overlayEl) return;
    overlayEl.classList.remove('active');
    // Stop YouTube iframe playback if closing the main game info modal
    if (overlayEl.id === 'gameModal') {
        const trailer = document.getElementById('modalTrailer');
        if (trailer) setTimeout(() => { trailer.src = ''; }, 200);
    }
}

function toggleMobileMenu(e) {
    if (e) e.stopPropagation();
    const dropdown = document.getElementById('mobileDropdownMenu');
    const menuBtn = document.getElementById('mobileMenuToggleBtn');
    const menuIcon = document.getElementById('mobileMenuIcon');
    if (!dropdown) return;
    const isOpen = dropdown.classList.toggle('mobile-menu-open');
    if (menuBtn) menuBtn.setAttribute('aria-expanded', String(isOpen));
    if (menuIcon) menuIcon.textContent = isOpen ? '✕' : '☰';
}

document.addEventListener('click', (e) => {
    // 1. Clicking directly on the dark .modal-overlay backdrop closes any modal
    if (e.target && e.target.classList && e.target.classList.contains('modal-overlay') && e.target.classList.contains('active')) {
        closeOverlayModal(e.target);
    }

    // 2. Clicking outside the mobile hamburger dropdown closes it
    const dropdown = document.getElementById('mobileDropdownMenu');
    const menuBtn = document.getElementById('mobileMenuToggleBtn');
    if (dropdown && dropdown.classList.contains('mobile-menu-open')) {
        if (!dropdown.contains(e.target) && (!menuBtn || !menuBtn.contains(e.target))) {
            dropdown.classList.remove('mobile-menu-open');
            if (menuBtn) {
                menuBtn.setAttribute('aria-expanded', 'false');
                menuBtn.innerHTML = '☰';
            }
        }
    }
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        document.querySelectorAll('.modal-overlay.active').forEach(closeOverlayModal);
        if (typeof closeMobileLeaderboard === 'function') closeMobileLeaderboard();
        const dropdown = document.getElementById('mobileDropdownMenu');
        const menuBtn = document.getElementById('mobileMenuToggleBtn');
        if (dropdown) dropdown.classList.remove('mobile-menu-open');
        if (menuBtn) {
            menuBtn.setAttribute('aria-expanded', 'false');
            menuBtn.innerHTML = '☰';
        }
    }
});

// --- GPU-Optimized Botanical Background Engine (GSAP 3) ---
document.addEventListener('DOMContentLoaded', () => {
    const bgContainer = document.querySelector('.background-container');
    if (!bgContainer || typeof gsap === 'undefined') return;

    const layer = document.createElement('div');
    layer.className = 'floral-bg-layer';
    bgContainer.appendChild(layer);

    // Flat SVG fills (avoids duplicate <radialGradient> ID shader lag during scroll)
    const flowerSvg = `<svg viewBox="0 0 64 64" width="100%" height="100%">
        <g fill="#b8a6e8" stroke="#4c3780" stroke-width="1.5">
            <path d="M32 6 C25 16, 22 24, 32 32 C42 24, 39 16, 32 6 Z"/>
            <path d="M32 6 C25 16, 22 24, 32 32 C42 24, 39 16, 32 6 Z" transform="rotate(72 32 32)"/>
            <path d="M32 6 C25 16, 22 24, 32 32 C42 24, 39 16, 32 6 Z" transform="rotate(144 32 32)"/>
            <path d="M32 6 C25 16, 22 24, 32 32 C42 24, 39 16, 32 6 Z" transform="rotate(216 32 32)"/>
            <path d="M32 6 C25 16, 22 24, 32 32 C42 24, 39 16, 32 6 Z" transform="rotate(288 32 32)"/>
        </g>
        <circle cx="32" cy="32" r="5" fill="#5e4796"/>
        <circle cx="32" cy="32" r="2.5" fill="#f6c85f"/>
    </svg>`;

    const singlePetalSvg = `<svg viewBox="0 0 32 32" width="100%" height="100%">
        <path d="M16 2 C8 12, 6 22, 16 30 C26 22, 24 12, 16 2 Z" fill="#9d8ec7" opacity="0.8"/>
    </svg>`;

    // 8 Drifting Petals (Compositor-only transforms)
    for (let i = 0; i < 8; i++) {
        const el = document.createElement('div');
        el.className = 'floating-petal';
        const isFullFlower = i % 2 === 0;
        const size = isFullFlower ? 22 : 14;
        el.style.width = `${size}px`;
        el.style.height = `${size}px`;
        el.innerHTML = isFullFlower ? flowerSvg : singlePetalSvg;
        layer.appendChild(el);

        gsap.set(el, { x: Math.random() * window.innerWidth, y: Math.random() * window.innerHeight, rotation: Math.random() * 360, force3D: true });

        gsap.to(el, {
            y: window.innerHeight + 50,
            rotation: `+=${240}`,
            duration: Math.random() * 16 + 16,
            ease: "none",
            repeat: -1,
            force3D: true,
            onRepeat: () => {
                gsap.set(el, { y: -50, x: Math.random() * window.innerWidth });
            }
        });
    }

    // 6 Firefly Spores
    for (let i = 0; i < 6; i++) {
        const spore = document.createElement('div');
        spore.className = 'firefly-spore';
        spore.style.width = '4px';
        spore.style.height = '4px';
        layer.appendChild(spore);

        gsap.set(spore, { x: Math.random() * window.innerWidth, y: Math.random() * window.innerHeight, opacity: 0.4, force3D: true });

        gsap.to(spore, {
            y: `-=160`,
            opacity: 0.85,
            duration: Math.random() * 8 + 8,
            ease: "sine.inOut",
            yoyo: true,
            repeat: -1,
            force3D: true
        });
    }
});

// --- Global Background Pause on Modal Open ---
document.addEventListener('DOMContentLoaded', () => {
    const modalObserver = new MutationObserver(() => {
        if (typeof gsap === 'undefined') return;
        
        // Checks if ANY modal on the screen has the 'active' class
        const anyModalActive = document.querySelectorAll('.modal-overlay.active').length > 0;
        
        if (anyModalActive) {
            gsap.globalTimeline.pause(); // Freezes all background frame rendering instantly
        } else {
            gsap.globalTimeline.play();  // Resumes seamlessly when the modal closes
        }
    });
    
    // Monitors the entire DOM for class changes on modals efficiently
    modalObserver.observe(document.body, { 
        attributes: true, 
        subtree: true, 
        attributeFilter: ['class'] 
    });
});

// --- AD VISIBILITY & SESSION DISMISSAL ENGINE ---
window.dismissAllAdsForSession = function() {
    sessionStorage.setItem('nurture_ads_dismissed', 'true');
    document.querySelectorAll('.nurture-ad-unit').forEach(el => {
        el.style.display = 'none';
    });
};

window.evaluateAdVisibility = function(user = null) {
    const dismissedThisSession = sessionStorage.getItem('nurture_ads_dismissed') === 'true';
    const isAdFreeMember = Boolean(user && user.isNurtureMember);
    const shouldHideAds = dismissedThisSession || isAdFreeMember;

    document.querySelectorAll('.nurture-ad-unit').forEach(el => {
        if (shouldHideAds) {
            el.style.display = 'none';
        } else {
            el.style.display = el.classList.contains('nurture-ad-bottom') ? 'flex' : 'flex';
        }
    });
};

window.syncUserPreferences = async function(payload) {
    const cachedUserRaw = localStorage.getItem('nurture_user_session');
    if (!cachedUserRaw) return;
    try {
        await fetch('/api/user/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
    } catch (e) {}
};

function getMobileTrophyBtnHtml() {
    if (!document.getElementById('leaderboardSidebar')) return '';
    return `
        <button type="button" class="social-button mobile-trophy-btn" onclick="openMobileLeaderboard()" title="View Leaderboard">
            <svg viewBox="0 0 24 24"><path d="M19 5h-2V3H7v2H5c-1.1 0-2 .9-2 2v1c0 2.55 1.92 4.63 4.39 4.94.63 1.5 1.98 2.63 3.61 2.96V19H7v2h10v-2h-4v-3.1c1.63-.33 2.98-1.46 3.61-2.96C19.08 12.63 21 10.55 21 8V7c0-1.1-.9-2-2-2zM5 8V7h2v3.82C5.84 10.4 5 9.3 5 8zm14 0c0 1.3-.84 2.4-2 2.82V7h2v1z"/></svg>
        </button>
    `;
}

function getMobileHamburgerBtnHtml() {
    return `
        <button type="button" id="mobileMenuToggleBtn" class="mobile-menu-toggle" onclick="toggleMobileMenu(event)" aria-label="Toggle Navigation Menu" aria-expanded="false">
            <span id="mobileMenuIcon">☰</span>
            <span id="mobileMenuUnreadDot" class="mobile-unread-dot" style="display:none;"></span>
        </button>
    `;
}

// Global Auth Gate: Opens the themed Sign-In Modal instead of a browser alert()
window.openAuthPromptModal = function(actionText = 'perform this action') {
    const modal = document.getElementById('authPromptModal');
    const msgEl = document.getElementById('authPromptMessage');
    if (msgEl) {
        msgEl.textContent = `You need to sign in with Discord to ${actionText}.`;
    }
    if (modal) modal.classList.add('active');
};

window.requireAuth = function(actionText = 'continue') {
    try {
        const session = JSON.parse(localStorage.getItem('nurture_user_session') || '{}');
        if (session && session.discordId) return true;
    } catch (e) {}
    window.openAuthPromptModal(actionText);
    return false;
};

// --- UI Render Helpers ---
function renderLoggedOutUI(container) {
    container.innerHTML = `
        <div class="banner-primary-actions">
            <div class="no-ads-cta-wrap">
                <a href="/auth/discord" class="social-button discord-button no-ads-pulse-btn">
                    <img src="https://cdn.simpleicons.org/discord/ffffff" alt="Discord Icon">
                    <span class="sub-text">Sign In</span>
                </a>
                <span class="no-ads-sub-label">Link Discord = No Ads FOREVER</span>
            </div>
            ${getMobileTrophyBtnHtml()}
            ${getMobileHamburgerBtnHtml()}
        </div>
        <div class="banner-secondary-actions" id="mobileDropdownMenu">
            <a href="https://discord.gg/nurture" target="_blank" class="social-button nurture-discord-button">
                <img src="/Assets/nurture_icon.webp" alt="Nurture Discord"><span class="sub-text">Nurture Discord</span>
            </a>
            <a href="https://ko-fi.com/sorakoi" target="_blank" class="social-button kofi-button">
                <img src="/Assets/kofi_icon.webp" alt="Ko-fi Icon"><span class="sub-text">Ko-fi</span>
            </a>
        </div>
    `;
    window.evaluateAdVisibility(null);
}

function renderLoggedInUI(container, user) {
    const avatarUrl = user.avatar ? `https://cdn.discordapp.com/avatars/${user.discordId}/${user.avatar}.webp` : 'https://cdn.discordapp.com/embed/avatars/0.webp';
    const nurtureDiscordButton = user.isNurtureMember ? '' : `
        <div class="no-ads-cta-wrap">
            <a href="https://discord.gg/nurture" target="_blank" class="social-button nurture-discord-button no-ads-pulse-btn">
                <img src="/Assets/nurture_icon.webp"><span class="sub-text">Nurture Discord</span>
            </a>
            <span class="no-ads-sub-label">Join Server = No Ads FOREVER</span>
        </div>
    `;
    
    const mailboxSvg = `<svg viewBox="0 0 24 24"><path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/></svg>`;
    const settingsSvg = `<svg viewBox="0 0 24 24"><path d="M19.14,12.94c0.04-0.3,0.06-0.61,0.06-0.94c0-0.32-0.02-0.64-0.06-0.94l2.03-1.58c0.18-0.14,0.23-0.41,0.12-0.61l-1.92-3.32c-0.12-0.22-0.37-0.29-0.59-0.22l-2.39,0.96c-0.5-0.38-1.03-0.7-1.62-0.94L14.4,2.81c-0.04-0.24-0.24-0.41-0.48-0.41h-3.84c-0.24,0-0.43,0.17-0.47,0.41L9.25,5.35C8.66,5.59,8.12,5.92,7.63,6.29L5.24,5.33c-0.22-0.08-0.47,0-0.59,0.22L2.73,8.87C2.62,9.08,2.66,9.34,2.86,9.48l2.03,1.58C4.84,11.36,4.8,11.69,4.8,12s0.02,0.64,0.06,0.94l-2.03,1.58c-0.18,0.14-0.23,0.41-0.12,0.61l1.92,3.32c0.12,0.22,0.37,0.29,0.59,0.22l2.39-0.96c0.5,0.38,1.03,0.7,1.62,0.94l0.36,2.54c0.05,0.24,0.24,0.41,0.48,0.41h3.84c0.24,0,0.43-0.17,0.47-0.41l0.36-2.54c0.59-0.24,1.13-0.56,1.62-0.94l2.39,0.96c0.22,0.08,0.47,0,0.59-0.22l1.92-3.32c0.12-0.22,0.07-0.49-0.12-0.61L19.14,12.94z M12,15.6c-1.98,0-3.6-1.62-3.6-3.6s1.62-3.6,3.6-3.6s3.6,1.62,3.6,3.6S13.98,15.6,12,15.6z"/></svg>`;
    const signOutDoorSvg = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z"/></svg>`;
    
    container.innerHTML = `
        <div class="banner-primary-actions">
            <div class="user-profile-badge" style="cursor:pointer;" onclick="window.location.href='/profile/${user.discordId}'" title="View My Stuff">
                <img src="${avatarUrl}" class="user-avatar">
                <span class="user-name">${user.username}</span>
                <a href="/auth/logout" class="sign-out-btn desktop-only-signout" title="Sign Out" aria-label="Sign Out" onclick="event.stopPropagation(); clearCachedAuth()">
                    ${signOutDoorSvg}
                </a>
            </div>
            ${getMobileTrophyBtnHtml()}
            ${getMobileHamburgerBtnHtml()}
        </div>
        <div class="banner-secondary-actions" id="mobileDropdownMenu">
            <button type="button" class="social-button mailbox-button" onclick="openMailboxModal()">
                ${mailboxSvg} <span class="sub-text">Mailbox <span id="unreadBadge" style="display:none; background:#ff5555; border-radius:10px; padding:2px 6px; margin-left:4px;">0</span></span>
            </button>
            <button type="button" class="social-button settings-button" onclick="openSettingsModal()">
                ${settingsSvg} <span class="sub-text">Settings</span>
            </button>
            ${nurtureDiscordButton}
            <a href="https://ko-fi.com/sorakoi" target="_blank" rel="noopener noreferrer" class="social-button kofi-button">
                <img src="/Assets/kofi_icon.webp" alt="Ko-fi"><span class="sub-text">Ko-fi</span>
            </a>
            <a href="/auth/logout" class="social-button blossom mobile-only-signout" onclick="clearCachedAuth()">
                ${signOutDoorSvg} <span class="sub-text">Sign Out</span>
            </a>
        </div>
    `;
    window.evaluateAdVisibility(user);
    fetchUnreadMailCount();
}

function clearCachedAuth() { localStorage.removeItem('nurture_user_session'); }

async function fetchUnreadMailCount() {
    try {
        const res = await fetch('/api/mailbox');
        if (!res.ok) return;
        const mail = await res.json();
        const unread = mail.filter(m => !m.read && m.direction === 'INBOUND').length;
        const badge = document.getElementById('unreadBadge');
        const mobileDot = document.getElementById('mobileMenuUnreadDot');
        if (badge) {
            badge.textContent = unread;
            badge.style.display = unread > 0 ? 'inline-block' : 'none';
        }
        if (mobileDot) {
            mobileDot.style.display = unread > 0 ? 'block' : 'none';
        }
    } catch (e) {}
}

function initAuth() {
    const authContainer = document.getElementById('authContainer');
    if (!authContainer) return;

    const cachedUserRaw = localStorage.getItem('nurture_user_session');
    if (cachedUserRaw) {
        try { renderLoggedInUI(authContainer, JSON.parse(cachedUserRaw)); } 
        catch (e) { localStorage.removeItem('nurture_user_session'); renderLoggedOutUI(authContainer); }
    } else { renderLoggedOutUI(authContainer); }

    fetch('/api/auth/me')
        .then(res => {
            if (res.status === 401) {
                localStorage.removeItem('nurture_user_session');
                renderLoggedOutUI(authContainer);
                throw new Error("Unauthorized");
            }
            return res.json();
        })
        .then(data => {
            if (data && data.authenticated && data.user) {
                localStorage.setItem('nurture_user_session', JSON.stringify(data.user));
                renderLoggedInUI(authContainer, data.user);

                if (data.user.settings) {
                    localStorage.setItem('nurture_settings', JSON.stringify(data.user.settings));
                    applySettings();
                }

                if (data.user.collapsedChangelogId !== undefined) {
                    if (data.user.collapsedChangelogId) {
                        localStorage.setItem('nurture_collapsed_changelog_id', data.user.collapsedChangelogId);
                    } else {
                        localStorage.removeItem('nurture_collapsed_changelog_id');
                    }
                    if (typeof initChangelogs === 'function') initChangelogs();
                }

                if (data.user.starredSubItems && typeof data.user.starredSubItems === 'object') {
                    for (const [gId, itemIds] of Object.entries(data.user.starredSubItems)) {
                        localStorage.setItem(`nurture_fav_items_${gId}`, JSON.stringify(itemIds));
                    }
                }

                if (data.user.copiedCoupons && typeof data.user.copiedCoupons === 'object') {
                    for (const [gId, codes] of Object.entries(data.user.copiedCoupons)) {
                        localStorage.setItem(`nurture_copied_codes_${gId}`, JSON.stringify(codes));
                    }
                }

                window.dispatchEvent(new CustomEvent('nurtureUserSynced', { detail: data.user }));
            }
        }).catch(() => {});
}
document.addEventListener('DOMContentLoaded', initAuth);

document.addEventListener('DOMContentLoaded', () => {
    // 1. Inject Mobile Leaderboard Close Button & Backdrop if page has a Leaderboard
    const lbSidebar = document.getElementById('leaderboardSidebar');
    if (lbSidebar && !lbSidebar.querySelector('.lb-mobile-close')) {
        const closeBtn = document.createElement('button');
        closeBtn.className = 'lb-mobile-close';
        closeBtn.innerHTML = '×';
        closeBtn.onclick = closeMobileLeaderboard;
        lbSidebar.prepend(closeBtn);

        const lbBackdrop = document.createElement('div');
        lbBackdrop.id = 'mobileLbBackdrop';
        lbBackdrop.className = 'mobile-lb-backdrop';
        lbBackdrop.onclick = closeMobileLeaderboard;
        document.body.appendChild(lbBackdrop);
    }

    // 2. Inject Upgraded Botanical Modals (Mailbox, Compose, Profile, Settings)
    const modalWrapper = document.createElement('div');
    modalWrapper.innerHTML = `
        <div id="mailboxModal" class="modal-overlay">
            <div class="modal-window" style="max-width: 600px;">
                <button class="modal-close" onclick="closeMailboxModal()">×</button>
                <h2 class="modal-title" style="display: flex; justify-content: space-between; align-items: center; padding-right: 42px;">
                    <span>User Mailbox</span>
                    <button class="btn-floral" onclick="markAllRead()" style="font-size: 0.5em; padding: 6px 12px;">✓ Mark All Read</button>
                </h2>
                <div id="mailboxContent" style="max-height: 350px; overflow-y: auto; margin-bottom: 16px; padding-right: 4px;">Loading messages...</div>
                <button class="btn-floral blossom" style="width:100%; padding:12px;" onclick="openComposeModal()">Send New Message to Staff ✉️</button>
            </div>
        </div>
        <div id="composeModal" class="modal-overlay">
            <div class="modal-window" style="max-width: 500px;">
                <button class="modal-close" onclick="closeComposeModal()">×</button>
                <h2 class="modal-title">🌺 Message Staff</h2>
                <input type="text" id="mailSubject" class="floral-input" placeholder="Subject (Optional)..." style="margin-bottom:12px;">
                <div class="req-field-row">
                    <textarea id="mailContent" class="floral-textarea" placeholder="Write your message here..." style="height:130px; resize:none;"></textarea>
                    <span class="req-icon" title="Required Field">
                        <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
                    </span>
                </div>
                <button class="btn-floral blossom" style="width:100%; margin-top:14px; padding:12px;" onclick="sendMail()">🌸 Send Message</button>
            </div>
        </div>
        <div id="userProfileModal" class="modal-overlay">
            <div class="modal-window" style="max-width: 500px;">
                <button class="modal-close" onclick="closeUserProfileModal()">×</button>
                <div style="display:flex; align-items:center; gap: 15px; margin-bottom: 16px;">
                    <img id="upAvatar" src="/Assets/placeholder.webp" style="width: 60px; height: 60px; border-radius: 50%; border: 2px solid #9d8ec7; object-fit: cover;">
                    <div>
                        <h2 class="modal-title" style="margin:0; border:none; padding:0 0 6px 0;" id="upUsername">Loading...</h2>
                        <div id="upPoints" style="display:flex; align-items:center; gap:8px;">...</div>
                    </div>
                </div>
                <a id="upViewProfileBtn" href="#" class="btn-floral pollen" style="width: 100%; box-sizing: border-box; margin-bottom: 16px; padding: 10px; display: none;">
                    View My Profile
                </a>
                <h3 style="border-bottom: 1px solid rgba(157, 142, 199, 0.28); padding-bottom: 8px; margin-top: 0; color: #d0c2f7;">✿ Approved Contributions</h3>
                <div id="upContributions" style="max-height: 300px; overflow-y: auto; padding-right: 5px;"></div>
            </div>
        </div>
        <div id="settingsModal" class="modal-overlay">
            <div class="modal-window" style="max-width: 420px;">
                <button class="modal-close" onclick="closeSettingsModal()">×</button>
                <h2 class="modal-title">🌿 Display Settings</h2>
                <label class="floral-setting-card">
                    <div>
                        <div style="font-weight:bold; color:#f4f0ff;">Show Leaderboard Panel</div>
                        <div style="font-size:0.75em; color:#a99ec7;">Display contributor rankings on desktop</div>
                    </div>
                    <input type="checkbox" id="toggleLeaderboard" class="floral-checkbox" checked onchange="saveSettings()">
                </label>
                <label class="floral-setting-card" style="margin-bottom:0;">
                    <div>
                        <div style="font-weight:bold; color:#f4f0ff;">Leaderboard Position</div>
                        <div style="font-size:0.75em; color:#a99ec7;">Choose which side the panel blooms</div>
                    </div>
                    <select id="selectLbSide" class="floral-select" style="width: auto; padding: 8px 14px;" onchange="saveSettings()">
                        <option value="right">Right Side</option>
                        <option value="left">Left Side</option>
                    </select>
                </label>
            </div>
        </div>
        <div id="authPromptModal" class="modal-overlay">
            <div class="modal-window" style="max-width: 420px; text-align: center;">
                <button class="modal-close" onclick="document.getElementById('authPromptModal').classList.remove('active')">×</button>
                <h2 class="modal-title">Sign In Required</h2>
                <p id="authPromptMessage" style="color: #e5dcff; font-size: 0.98em; line-height: 1.5; margin: 14px 0 22px 0;">
                    You need to sign in with Discord to perform this action.
                </p>
                <div style="display: flex; gap: 12px; justify-content: center;">
                    <a href="/auth/discord" class="social-button discord-button" style="flex: 1; justify-content: center;">
                        <img src="https://cdn.simpleicons.org/discord/ffffff" alt="Discord Icon">
                        <span class="sub-text">Sign In</span>
                    </a>
                    <button type="button" class="btn-floral" style="flex: 1;" onclick="document.getElementById('authPromptModal').classList.remove('active')">
                        Cancel
                    </button>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(modalWrapper);
    // Enhance all modals and close buttons with ARIA accessibility attributes
    document.querySelectorAll('.modal-overlay').forEach(modal => {
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
    });
    document.querySelectorAll('.modal-close').forEach(btn => {
        btn.setAttribute('aria-label', 'Close modal');
    });
    setTimeout(applySettings, 100);
});

function openMobileLeaderboard() {
    const lb = document.getElementById('leaderboardSidebar');
    const backdrop = document.getElementById('mobileLbBackdrop');
    if (lb) lb.classList.add('mobile-open');
    if (backdrop) backdrop.classList.add('active');
}

function closeMobileLeaderboard() {
    const lb = document.getElementById('leaderboardSidebar');
    const backdrop = document.getElementById('mobileLbBackdrop');
    if (lb) lb.classList.remove('mobile-open');
    if (backdrop) backdrop.classList.remove('active');
}

function openMailboxModal() { 
    document.getElementById('mailboxModal').classList.add('active'); 
    document.getElementById('mailboxContent').innerHTML = '<p style="color:#a99ec7; text-align:center;">Loading messages...</p>';
    setTimeout(loadMailboxMessages, 50); 
}

async function markAsRead(id, element) {
    try {
        await fetch('/api/mailbox/mark-read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messageIds: [id] }) });
        element.classList.remove('unread');
        element.onclick = null;
        const badge = element.querySelector('.new-badge');
        if (badge) badge.style.display = 'none';
        fetchUnreadMailCount();
    } catch(e) {}
}

async function markAllRead() {
    try {
        await fetch('/api/mailbox/mark-read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messageIds: [] }) });
        loadMailboxMessages(); 
        document.getElementById('unreadBadge').style.display = 'none';
    } catch (e) { alert("Failed to mark messages as read."); }
}
function closeMailboxModal() { document.getElementById('mailboxModal').classList.remove('active'); }
function openComposeModal() { document.getElementById('composeModal').classList.add('active'); }
function closeComposeModal() { document.getElementById('composeModal').classList.remove('active'); }
function openSettingsModal() { document.getElementById('settingsModal').classList.add('active'); }
function closeSettingsModal() { document.getElementById('settingsModal').classList.remove('active'); }

async function openUserProfileModal(discordId, username = null) {
    const query = discordId || username;
    if (!query) return;
    
    document.getElementById('userProfileModal').classList.add('active');
    const container = document.getElementById('upContributions');
    const viewProfileBtn = document.getElementById('upViewProfileBtn');
    container.innerHTML = '<p style="color:#a99ec7;">Loading profile...</p>';
    if (viewProfileBtn) viewProfileBtn.style.display = 'none';
    
    try {
        const res = await fetch(`/api/profile/${encodeURIComponent(query)}`);
        if (!res.ok) {
            container.innerHTML = '<p style="color:#d96b98;">User not found or is an external author.</p>';
            document.getElementById('upUsername').textContent = username || 'Unknown User';
            document.getElementById('upAvatar').src = '/Assets/placeholder.webp';
            document.getElementById('upPoints').innerHTML = '<span style="color:#7bc996; font-weight:bold;">0 pts</span>';
            return;
        }
        
        const data = await res.json();
        const escapeTxt = (txt) => (txt || '').toString().replace(/[&<>"']/g, m => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[m]));
        
        document.getElementById('upUsername').textContent = data.username;
        document.getElementById('upAvatar').src = data.avatar ? `https://cdn.discordapp.com/avatars/${data.discordId}/${data.avatar}.webp` : 'https://cdn.discordapp.com/embed/avatars/0.webp';
        
        // Show Leaderboard Rank Badge next to points if ranked: [#1] 6pts
        const rankClass = (data.rank && data.rank <= 3) ? `rank-${data.rank}` : '';
        const rankBadgeHtml = data.rank ? `<span class="lb-rank-badge">#${data.rank}</span>` : '';
        document.getElementById('upPoints').innerHTML = `
            <div class="lb-row ${rankClass}" style="background:none; border:none; padding:0; margin:0; display:inline-flex; align-items:center; gap:8px;">
                ${rankBadgeHtml}
                <span style="color: #7bc996; font-weight: bold; font-size: 1.05em;">${data.totalPoints}pts</span>
            </div>
        `;

        if (viewProfileBtn) {
            viewProfileBtn.href = `/profile/${encodeURIComponent(data.discordId || data.username)}`;
            viewProfileBtn.style.display = 'inline-flex';
        }
        
        if (!data.contributions || data.contributions.length === 0) {
            container.innerHTML = '<p style="color:#a99ec7;">No approved contributions yet.</p>';
            return;
        }
        
        const grouped = {};
        data.contributions.forEach(c => {
            if (!grouped[c.gameId]) grouped[c.gameId] = { name: c.gameName, icon: c.gameIcon, items: [] };
            grouped[c.gameId].items.push(c);
        });

        container.innerHTML = Object.values(grouped).map(group => `
            <div class="profile-game-group open">
                <div class="profile-game-header" onclick="this.parentElement.classList.toggle('open')">
                    <div style="display:flex; align-items:center; gap:10px;">
                        <img src="${group.icon}" style="width:24px; height:24px; border-radius:6px; object-fit:cover; border: 1px solid rgba(157, 142, 199, 0.4);">
                        <strong style="color: #f4f0ff;">${escapeTxt(group.name)} <span style="color: #7bc996;">(+${group.items.length})</span></strong>
                    </div>
                    <span class="toggle-arrow" style="font-size:0.8em; color:#a99ec7;">▼</span>
                </div>
                <div class="profile-game-items">
                    ${group.items.map(c => {
                        const tabMap = { 'Guide': 'guides', 'Asset': 'assets', 'Community': 'communities', 'Mod': 'mods', 'Coupon': 'overview', 'Game': 'overview' };
                        const tab = tabMap[c.category] || 'overview';
                        const link = c.gameId ? `/games/${c.gameId}?tab=${tab}` : '/';
                        return `
                            <a href="${link}" class="floral-mail-card" style="display:block; text-decoration:none; color:white; padding: 10px 14px; margin-bottom: 8px;">
                                <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:6px;">
                                    <div style="font-weight:bold; color:#d0c2f7; font-size:1.05em;">${escapeTxt(c.target)}</div>
                                    <span style="font-size:0.75em; color:#a99ec7;">${new Date(c.date).toLocaleDateString()}</span>
                                </div>
                                <div style="font-size:0.8em; color:#a99ec7; display:flex; align-items:center; gap:6px;">
                                    <strong style="color:#f6c85f; background:rgba(246, 200, 95, 0.12); padding:2px 8px; border-radius:8px 2px 8px 2px; border:1px solid rgba(246, 200, 95, 0.35);">${c.action ? c.action.toUpperCase() : 'EDIT'}</strong> 
                                    <span>in ${c.category}</span>
                                </div>
                                ${c.commitMessage ? `<div style="font-size:0.85em; color:#e5dcff; border-left:2px solid #9d8ec7; padding-left:8px; margin-top:8px; font-style: italic;">${escapeTxt(c.commitMessage)}</div>` : ''}
                            </a>
                        `;
                    }).join('')}
                </div>
            </div>
        `).join('');
    } catch (e) { container.innerHTML = '<p style="color:#d96b98;">Failed to load profile.</p>'; }
}
function closeUserProfileModal() { document.getElementById('userProfileModal').classList.remove('active'); }

async function loadMailboxMessages() {
    const container = document.getElementById('mailboxContent');
    try {
        const res = await fetch('/api/mailbox');
        const mail = await res.json();
        if (!mail || mail.length === 0) {
            container.innerHTML = '<p style="color:#a99ec7; text-align:center; padding: 20px 0;">🌱 Your mailbox is peaceful and empty.</p>';
            return;
        }
        
        container.innerHTML = mail.map(m => {
            let senderInfo = '';
            let statusBadge = '';
            
            if (m.direction === 'INBOUND') {
                const avatar = m.adminAvatar || 'https://cdn.discordapp.com/embed/avatars/0.webp';
                const name = m.adminUsername || 'Admin';
                senderInfo = `<img src="${avatar}" style="width:22px;height:22px;border-radius:50%;vertical-align:middle;margin-right:6px; border: 1.5px solid #9d8ec7;"><b>${name}</b>`;
            } else if (m.direction === 'OUTBOUND_CONTRIBUTION') {
                senderInfo = `<b>🌸 Contribution</b>`;
                const statusStr = (m.status || 'Pending').toUpperCase();
                const bg = statusStr === 'APPROVED' ? 'rgba(123, 201, 150, 0.2)' : statusStr === 'REJECTED' ? 'rgba(217, 107, 152, 0.2)' : 'rgba(246, 200, 95, 0.2)';
                const border = statusStr === 'APPROVED' ? '#7bc996' : statusStr === 'REJECTED' ? '#d96b98' : '#f6c85f';
                statusBadge = `<span class="floral-badge" style="background:${bg}; color:${border}; border:1px solid ${border};">${statusStr}</span>`;
            } else {
                senderInfo = `<b>🍃 You</b>`;
            }

            const isUnread = !m.read && m.direction === 'INBOUND';
            const newBadge = isUnread ? `<span class="floral-badge new-badge" style="background:#d96b98; color:#fff;">NEW</span>` : '';
            const escapeMail = (text) => (text || '').replace(/[&<>"']/g, match => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[match]));

            return `
            <div class="floral-mail-card ${isUnread ? 'unread' : ''}" ${isUnread ? `onclick="markAsRead('${m.id}', this)"` : ''}>
                <div style="display:flex; justify-content:space-between; font-size:0.85em; color:#b8a6e8; margin-bottom:8px; align-items:center;">
                    <div>${senderInfo} — <span style="color:#f4f0ff;">${escapeMail(m.subject)}</span> ${statusBadge} ${newBadge}</div>
                    <span style="font-size:0.85em; color:#887da8;">${new Date(m.date).toLocaleDateString()}</span>
                </div>
                <div style="color:#e5dcff; font-size:0.92em; white-space:pre-wrap; line-height:1.45;">${escapeMail(m.content)}</div>
            </div>
            `;
        }).join('');
    } catch (e) { container.innerHTML = '<p style="color:#d96b98;">Failed to load mailbox.</p>'; }
}

async function sendMail() {
    const subject = document.getElementById('mailSubject').value;
    const content = document.getElementById('mailContent').value;
    if (!content) return alert('Message content cannot be blank.');
    try {
        const res = await fetch('/api/mailbox/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subject, content }) });
        if (res.ok) { alert('Message sent to Discord!'); closeComposeModal(); document.getElementById('mailSubject').value = ''; document.getElementById('mailContent').value = ''; }
    } catch (e) { alert('Failed to send message.'); }
}

function saveSettings() {
    const showLb = document.getElementById('toggleLeaderboard').checked;
    const lbSide = document.getElementById('selectLbSide').value;
    const settingsObj = { showLb, lbSide };
    localStorage.setItem('nurture_settings', JSON.stringify(settingsObj));
    applySettings();
    window.syncUserPreferences({ settings: settingsObj });
}

function applySettings() {
    const raw = localStorage.getItem('nurture_settings');
    if (!raw) return;
    const { showLb, lbSide } = JSON.parse(raw);
    
    const lbEl = document.getElementById('leaderboardSidebar');
    const railEl = document.getElementById('rightRailColumn') || lbEl;
    const spacerEl = document.getElementById('lbSpacer');
    const subNavEl = document.getElementById('subNavSidebar');
    
    if (lbEl) {
        // Reserves the physical layout space so the center column doesn't break alignment
        railEl.style.opacity = showLb ? '1' : '0';
        railEl.style.pointerEvents = showLb ? 'auto' : 'none';
        
        if (spacerEl) {
            spacerEl.style.opacity = showLb ? '1' : '0';
            spacerEl.style.pointerEvents = showLb ? 'auto' : 'none';
        }

        if (lbSide === 'left') {
            railEl.style.order = '-1';
            if (spacerEl) spacerEl.style.order = '1';
            if (subNavEl) subNavEl.style.order = '1';
        } else {
            railEl.style.order = '1';
            if (spacerEl) spacerEl.style.order = '-1';
            if (subNavEl) subNavEl.style.order = '-1';
        }
    }

    const toggle = document.getElementById('toggleLeaderboard');
    const select = document.getElementById('selectLbSide');
    if (toggle) toggle.checked = showLb;
    if (select) select.value = lbSide;
}

// --- Real-Time Live Stream Client (No 15s Polling or Micro-Refreshes) ---
document.addEventListener('DOMContentLoaded', () => {
    if (typeof EventSource === 'undefined') return;

    let es;
    function connectLiveStream() {
        es = new EventSource('/api/stream');
        es.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (!data || data.type === 'connected') return;

                if (data.type === 'mail_updated' || data.type === 'game_updated') {
                    const cachedUserRaw = localStorage.getItem('nurture_user_session');
                    if (cachedUserRaw) fetchUnreadMailCount();
                }

                window.dispatchEvent(new CustomEvent('nurtureLiveUpdate', { detail: data }));
            } catch (e) {}
        };
        es.onerror = () => {
            es.close();
            setTimeout(connectLiveStream, 5000);
        };
    }

    connectLiveStream();
});