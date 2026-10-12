// Background Animation Logic (GSAP 3)
function animateWithRandomNumber(myClass, from, to) {
    if (typeof gsap === 'undefined') return;
    gsap.fromTo(myClass, 
        { y: from }, 
        { 
            duration: Math.floor((Math.random() * 20) + 1), 
            y: to, 
            ease: "none", 
            onComplete: animateWithRandomNumber, 
            onCompleteParams: [myClass, from, to] 
        }
    );
}

const itemsDown = [".light4", ".light5", ".light6", ".light7", ".light8", ".light11", ".light12", ".light13", ".light14", ".light15", ".light16"];
itemsDown.forEach(e => animateWithRandomNumber(e, -1080, 1080));

const itemsUp = [".light1", ".light2", ".light3", ".light9", ".light10", ".light17"];
itemsUp.forEach(e => animateWithRandomNumber(e, 1080, -1080));

// --- UI Render Helpers ---
function renderLoggedOutUI(container) {
    container.innerHTML = `
        <a href="/auth/discord" class="social-button discord-button">
            <img src="https://cdn.simpleicons.org/discord/ffffff" alt="Discord Icon">
            <span class="sub-text">Sign in with Discord</span>
        </a>
        <a href="https://discord.gg/nurture" target="_blank" rel="noopener noreferrer" class="social-button nurture-discord-button">
            <img src="/Assets/nurture_icon.png" alt="Nurture Discord">
            <span class="sub-text">Nurture Discord</span>
        </a>
        <a href="https://ko-fi.com/sorakoi" target="_blank" rel="noopener noreferrer" class="social-button kofi-button">
            <img src="/Assets/kofi_icon.png" alt="Ko-fi Icon">
            <span class="sub-text">Ko-fi</span>
        </a>
    `;
}

function renderLoggedInUI(container, user) {
    const avatarUrl = user.avatar 
        ? `https://cdn.discordapp.com/avatars/${user.discordId}/${user.avatar}.png` 
        : 'https://cdn.discordapp.com/embed/avatars/0.png';

    // Only generate the Discord button HTML if they are NOT in the server
    const nurtureDiscordButton = user.isNurtureMember ? '' : `
        <a href="https://discord.gg/nurture" target="_blank" rel="noopener noreferrer" class="social-button nurture-discord-button">
            <img src="/Assets/nurture_icon.png" alt="Nurture Discord">
            <span class="sub-text">Nurture Discord</span>
        </a>
    `;

    container.innerHTML = `
        <div class="user-profile-badge">
            <img src="${avatarUrl}" alt="Avatar" class="user-avatar">
            <span class="user-name">${user.username}</span>
            <a href="/auth/logout" class="sign-out-btn" onclick="clearCachedAuth()">Sign Out</a>
        </div>
        ${nurtureDiscordButton}
        <a href="https://ko-fi.com/sorakoi" target="_blank" rel="noopener noreferrer" class="social-button kofi-button">
            <img src="/Assets/kofi_icon.png" alt="Ko-fi Icon">
            <span class="sub-text">Ko-fi</span>
        </a>
    `;
}

function clearCachedAuth() {
    localStorage.removeItem('nurture_user_session');
}

// Instant Pre-render + Background Validation
function initAuth() {
    const authContainer = document.getElementById('authContainer');
    if (!authContainer) return;

    // 1. Instant optimistic render from localStorage to kill flash
    const cachedUserRaw = localStorage.getItem('nurture_user_session');
    if (cachedUserRaw) {
        try {
            const cachedUser = JSON.parse(cachedUserRaw);
            renderLoggedInUI(authContainer, cachedUser);
        } catch (e) {
            localStorage.removeItem('nurture_user_session');
            renderLoggedOutUI(authContainer);
        }
    } else {
        renderLoggedOutUI(authContainer);
    }

    // 2. Background verification with backend session cookie
    fetch('/api/auth/me')
        .then(res => res.json())
        .then(data => {
            if (data.authenticated && data.user) {
                localStorage.setItem('nurture_user_session', JSON.stringify(data.user));
                renderLoggedInUI(authContainer, data.user);
            } else {
                localStorage.removeItem('nurture_user_session');
                renderLoggedOutUI(authContainer);
            }
        })
        .catch(() => {
            // Network fallback: retain cache if serverless function cold-starts
        });
}

// --- MAILBOX & SETTINGS UI INJECTION ---
function renderLoggedInUI(container, user) {
    const avatarUrl = user.avatar 
        ? `https://cdn.discordapp.com/avatars/${user.discordId}/${user.avatar}.png` 
        : 'https://cdn.discordapp.com/embed/avatars/0.png';

    const nurtureDiscordButton = user.isNurtureMember ? '' : `
        <a href="https://discord.gg/nurture" target="_blank" rel="noopener noreferrer" class="social-button nurture-discord-button">
            <img src="/Assets/nurture_icon.png" alt="Nurture Discord">
            <span class="sub-text">Nurture Discord</span>
        </a>
    `;

    container.innerHTML = `
        <div class="user-profile-badge">
            <img src="${avatarUrl}" alt="Avatar" class="user-avatar">
            <span class="user-name">${user.username}</span>
            <a href="/auth/logout" class="sign-out-btn" onclick="clearCachedAuth()">Sign Out</a>
        </div>
        <button class="mailbox-icon-btn" onclick="openMailboxModal()" title="Mailbox">
            📬 <span id="unreadBadge" class="unread-badge" style="display:none;">0</span>
        </button>
        <button class="settings-icon-btn" onclick="openSettingsModal()" title="Settings">⚙️</button>
        ${nurtureDiscordButton}
        <a href="https://ko-fi.com/sorakoi" target="_blank" rel="noopener noreferrer" class="social-button kofi-button">
            <img src="/Assets/kofi_icon.png" alt="Ko-fi Icon">
            <span class="sub-text">Ko-fi</span>
        </a>
    `;
    fetchUnreadMailCount();
}

async function fetchUnreadMailCount() {
    try {
        const res = await fetch('/api/mailbox');
        if (!res.ok) return;
        const mail = await res.json();
        const unread = mail.filter(m => !m.read && m.direction === 'INBOUND').length;
        const badge = document.getElementById('unreadBadge');
        if (badge && unread > 0) {
            badge.textContent = unread;
            badge.style.display = 'inline-block';
        }
    } catch (e) {}
}

// Global modals injection for Mailbox & Settings
document.addEventListener('DOMContentLoaded', () => {
    const modalWrapper = document.createElement('div');
    modalWrapper.innerHTML = `
        <!-- Mailbox Modal -->
        <div id="mailboxModal" class="modal-overlay">
            <div class="modal-window" style="max-width: 600px;">
                <button class="modal-close" onclick="closeMailboxModal()">×</button>
                <h2 class="modal-title">📬 User Mailbox</h2>
                <div id="mailboxContent" style="max-height: 350px; overflow-y: auto; margin-bottom: 15px;">Loading messages...</div>
                <button class="filter-btn active" onclick="openComposeModal()">Compose New Message to Staff</button>
            </div>
        </div>

        <!-- Compose Modal -->
        <div id="composeModal" class="modal-overlay">
            <div class="modal-window" style="max-width: 500px;">
                <button class="modal-close" onclick="closeComposeModal()">×</button>
                <h2 class="modal-title">✉️ Message Staff</h2>
                <input type="text" id="mailSubject" placeholder="Subject" class="search-input" style="width:100%; margin-bottom:10px;">
                <textarea id="mailContent" placeholder="Write your message here..." style="width:100%; height:120px; background:#2a2a35; color:#fff; border:1px solid #3a3a45; border-radius:8px; padding:10px; resize:none;"></textarea>
                <button class="filter-btn active" style="margin-top:10px; width:100%;" onclick="sendMail()">Send Message</button>
            </div>
        </div>

        <!-- Settings Modal -->
        <div id="settingsModal" class="modal-overlay">
            <div class="modal-window" style="max-width: 400px;">
                <button class="modal-close" onclick="closeSettingsModal()">×</button>
                <h2 class="modal-title">⚙️ Display Settings</h2>
                <label style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px; cursor:pointer;">
                    <span>Show Leaderboard Panel</span>
                    <input type="checkbox" id="toggleLeaderboard" checked onchange="saveSettings()">
                </label>
                <label style="display:flex; justify-content:space-between; align-items:center; cursor:pointer;">
                    <span>Leaderboard Position</span>
                    <select id="selectLbSide" class="filter-btn" onchange="saveSettings()">
                        <option value="right">Right Side</option>
                        <option value="left">Left Side</option>
                    </select>
                </label>
            </div>
        </div>
    `;
    document.body.appendChild(modalWrapper);
});

function openMailboxModal() {
    document.getElementById('mailboxModal').classList.add('active');
    loadMailboxMessages();
}
function closeMailboxModal() { document.getElementById('mailboxModal').classList.remove('active'); }
function openComposeModal() { document.getElementById('composeModal').classList.add('active'); }
function closeComposeModal() { document.getElementById('composeModal').classList.remove('active'); }
function openSettingsModal() { document.getElementById('settingsModal').classList.add('active'); }
function closeSettingsModal() { document.getElementById('settingsModal').classList.remove('active'); }

async function loadMailboxMessages() {
    const container = document.getElementById('mailboxContent');
    try {
        const res = await fetch('/api/mailbox');
        const mail = await res.json();
        if (mail.length === 0) {
            container.innerHTML = '<p style="color:#888; text-align:center;">Your mailbox is empty.</p>';
            return;
        }
        container.innerHTML = mail.map(m => `
            <div style="background:#1f1f28; border:1px solid #3a3a45; padding:12px; border-radius:8px; margin-bottom:10px;">
                <div style="display:flex; justify-content:space-between; font-size:0.85em; color:#aaa; margin-bottom:4px;">
                    <span><b>${m.direction === 'INBOUND' ? '🛡️ Admin Reply' : '📤 You'}</b> — ${m.subject}</span>
                    <span>${new Date(m.date).toLocaleDateString()}</span>
                </div>
                <div style="color:#fff; font-size:0.95em; white-space:pre-wrap;">${m.content}</div>
            </div>
        `).join('');
    } catch (e) {
        container.innerHTML = '<p style="color:#ff5555;">Failed to load mailbox.</p>';
    }
}

async function sendMail() {
    const subject = document.getElementById('mailSubject').value;
    const content = document.getElementById('mailContent').value;
    if (!content) return alert('Message content cannot be blank.');

    try {
        const res = await fetch('/api/mailbox/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ subject, content })
        });
        if (res.ok) {
            alert('Message sent successfully to Discord!');
            closeComposeModal();
            document.getElementById('mailSubject').value = '';
            document.getElementById('mailContent').value = '';
        }
    } catch (e) {
        alert('Failed to send message.');
    }
}

function saveSettings() {
    const showLb = document.getElementById('toggleLeaderboard').checked;
    const lbSide = document.getElementById('selectLbSide').value;
    localStorage.setItem('nurture_settings', JSON.stringify({ showLb, lbSide }));
    applySettings();
}

function applySettings() {
    const raw = localStorage.getItem('nurture_settings');
    if (!raw) return;
    const { showLb, lbSide } = JSON.parse(raw);
    const lbEl = document.getElementById('leaderboardSidebar');
    if (lbEl) {
        lbEl.style.display = showLb ? 'block' : 'none';
        lbEl.style.order = lbSide === 'left' ? '-1' : '1';
    }
}

document.addEventListener('DOMContentLoaded', initAuth);