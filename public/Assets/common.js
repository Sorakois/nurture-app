// Background Animation Logic (GSAP 3)
function animateWithRandomNumber(myClass, from, to) {
    if (typeof gsap === 'undefined') return;
    gsap.fromTo(myClass, { y: from }, { duration: Math.floor((Math.random() * 20) + 1), y: to, ease: "none", onComplete: animateWithRandomNumber, onCompleteParams: [myClass, from, to] });
}
const itemsDown = [".light4", ".light5", ".light6", ".light7", ".light8", ".light11", ".light12", ".light13", ".light14", ".light15", ".light16"];
itemsDown.forEach(e => animateWithRandomNumber(e, -1080, 1080));
const itemsUp = [".light1", ".light2", ".light3", ".light9", ".light10", ".light17"];
itemsUp.forEach(e => animateWithRandomNumber(e, 1080, -1080));

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

// --- UI Render Helpers ---
function renderLoggedOutUI(container) {
    container.innerHTML = `
        <a href="/auth/discord" class="social-button discord-button">
            <img src="https://cdn.simpleicons.org/discord/ffffff" alt="Discord Icon">
            <span class="sub-text">Sign in with Discord</span>
        </a>
        <a href="https://discord.gg/nurture" target="_blank" class="social-button nurture-discord-button">
            <img src="/Assets/nurture_icon.png" alt="Nurture Discord"><span class="sub-text">Nurture Discord</span>
        </a>
        <a href="https://ko-fi.com/sorakoi" target="_blank" class="social-button kofi-button">
            <img src="/Assets/kofi_icon.png" alt="Ko-fi Icon"><span class="sub-text">Ko-fi</span>
        </a>
    `;
}

function renderLoggedInUI(container, user) {
    const avatarUrl = user.avatar ? `https://cdn.discordapp.com/avatars/${user.discordId}/${user.avatar}.png` : 'https://cdn.discordapp.com/embed/avatars/0.png';
    const nurtureDiscordButton = user.isNurtureMember ? '' : `<a href="https://discord.gg/nurture" target="_blank" class="social-button nurture-discord-button"><img src="/Assets/nurture_icon.png"><span class="sub-text">Nurture Discord</span></a>`;
    
    // Clean SVGs - sizes are now handled entirely by common.css
    const mailboxSvg = `<svg viewBox="0 0 24 24"><path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/></svg>`;
    const settingsSvg = `<svg viewBox="0 0 24 24"><path d="M19.14,12.94c0.04-0.3,0.06-0.61,0.06-0.94c0-0.32-0.02-0.64-0.06-0.94l2.03-1.58c0.18-0.14,0.23-0.41,0.12-0.61l-1.92-3.32c-0.12-0.22-0.37-0.29-0.59-0.22l-2.39,0.96c-0.5-0.38-1.03-0.7-1.62-0.94L14.4,2.81c-0.04-0.24-0.24-0.41-0.48-0.41h-3.84c-0.24,0-0.43,0.17-0.47,0.41L9.25,5.35C8.66,5.59,8.12,5.92,7.63,6.29L5.24,5.33c-0.22-0.08-0.47,0-0.59,0.22L2.73,8.87C2.62,9.08,2.66,9.34,2.86,9.48l2.03,1.58C4.84,11.36,4.8,11.69,4.8,12s0.02,0.64,0.06,0.94l-2.03,1.58c-0.18,0.14-0.23,0.41-0.12,0.61l1.92,3.32c0.12,0.22,0.37,0.29,0.59,0.22l2.39-0.96c0.5,0.38,1.03,0.7,1.62,0.94l0.36,2.54c0.05,0.24,0.24,0.41,0.48,0.41h3.84c0.24,0,0.43-0.17,0.47-0.41l0.36-2.54c0.59-0.24,1.13-0.56,1.62-0.94l2.39,0.96c0.22,0.08,0.47,0,0.59-0.22l1.92-3.32c0.12-0.22,0.07-0.49-0.12-0.61L19.14,12.94z M12,15.6c-1.98,0-3.6-1.62-3.6-3.6s1.62-3.6,3.6-3.6s3.6,1.62,3.6,3.6S13.98,15.6,12,15.6z"/></svg>`;
    
    container.innerHTML = `
        <div class="user-profile-badge" style="cursor:pointer;" onclick="openUserProfileModal('${user.discordId}')" title="View My Contributions">
            <img src="${avatarUrl}" class="user-avatar"><span class="user-name">${user.username}</span>
            <a href="/auth/logout" class="sign-out-btn" onclick="event.stopPropagation(); clearCachedAuth()">Sign Out</a>
        </div>
        <button class="social-button mailbox-button" onclick="openMailboxModal()" style="border:none; cursor:pointer; font-family:inherit;">
            ${mailboxSvg} <span class="sub-text">Mailbox <span id="unreadBadge" style="display:none; background:#ff5555; border-radius:10px; padding:2px 6px; margin-left:4px;">0</span></span>
        </button>
        <button class="social-button settings-button" onclick="openSettingsModal()" style="border:none; cursor:pointer; font-family:inherit;">
            ${settingsSvg} <span class="sub-text">Settings</span>
        </button>
        ${nurtureDiscordButton}
        <a href="https://ko-fi.com/sorakoi" target="_blank" rel="noopener noreferrer" class="social-button kofi-button">
            <img src="/Assets/kofi_icon.png" alt="Ko-fi"><span class="sub-text">Ko-fi</span>
        </a>
    `;
    fetchUnreadMailCount();
}

function clearCachedAuth() { localStorage.removeItem('nurture_user_session'); }

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
            }
        }).catch(() => {});
}
document.addEventListener('DOMContentLoaded', initAuth);

async function fetchUnreadMailCount() {
    try {
        const res = await fetch('/api/mailbox');
        if (!res.ok) return;
        const mail = await res.json();
        const unread = mail.filter(m => !m.read && m.direction === 'INBOUND').length;
        const badge = document.getElementById('unreadBadge');
        if (badge && unread > 0) { badge.textContent = unread; badge.style.display = 'inline-block'; }
    } catch (e) {}
}

document.addEventListener('DOMContentLoaded', () => {
    const modalWrapper = document.createElement('div');
    modalWrapper.innerHTML = `
        <div id="mailboxModal" class="modal-overlay">
            <div class="modal-window" style="max-width: 600px;">
                <button class="modal-close" onclick="closeMailboxModal()">×</button>
                <h2 class="modal-title" style="display: flex; justify-content: space-between; align-items: center;">
                    📬 User Mailbox
                    <span onclick="markAllRead()" style="font-size: 0.45em; color: #aaa; cursor: pointer; border: 1px solid #3a3a45; padding: 4px 10px; border-radius: 12px; font-weight: normal; transition: background 0.2s;" onmouseover="this.style.background='#3a3a45'" onmouseout="this.style.background='transparent'">Mark All Read</span>
                </h2>
                <div id="mailboxContent" style="max-height: 350px; overflow-y: auto; margin-bottom: 15px;">Loading messages...</div>
                <button style="width:100%; padding:10px; background:#4C3A90; color:white; border:none; border-radius:8px; font-weight:bold; cursor:pointer;" onclick="openComposeModal()">Compose New Message to Staff</button>
            </div>
        </div>
        <div id="composeModal" class="modal-overlay">
            <div class="modal-window" style="max-width: 500px;">
                <button class="modal-close" onclick="closeComposeModal()">×</button>
                <h2 class="modal-title">✉️ Message Staff</h2>
                <input type="text" id="mailSubject" placeholder="Subject" style="width:100%; padding:10px; margin-bottom:10px; border-radius:8px; border:1px solid #3a3a45; background:#2a2a35; color:white; box-sizing:border-box;">
                <textarea id="mailContent" placeholder="Write your message here..." style="width:100%; height:120px; background:#2a2a35; color:#fff; border:1px solid #3a3a45; border-radius:8px; padding:10px; resize:none; box-sizing:border-box;"></textarea>
                <button style="width:100%; margin-top:10px; padding:10px; background:#FF5E5B; color:white; border:none; border-radius:8px; font-weight:bold; cursor:pointer;" onclick="sendMail()">Send Message</button>
            </div>
        </div>
        <div id="userProfileModal" class="modal-overlay">
            <div class="modal-window" style="max-width: 500px;">
                <button class="modal-close" onclick="closeUserProfileModal()">×</button>
                <div style="display:flex; align-items:center; gap: 15px; margin-bottom: 20px;">
                    <img id="upAvatar" src="/Assets/placeholder.png" style="width: 60px; height: 60px; border-radius: 50%; border: 2px solid #7A6BB5; object-fit: cover;">
                    <div>
                        <h2 class="modal-title" style="margin:0; border:none; padding:0 0 5px 0;" id="upUsername">Loading...</h2>
                        <div style="color: #ffc107; font-weight: bold; font-size: 1.1em;" id="upPoints">...</div>
                    </div>
                </div>
                <h3 style="border-bottom: 1px solid #3a3a45; padding-bottom: 8px; margin-top: 0;">Approved Contributions</h3>
                <div id="upContributions" style="max-height: 300px; overflow-y: auto; padding-right: 5px;"></div>
            </div>
        </div>
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
                    <select id="selectLbSide" style="padding:6px; border-radius:6px; background:#1f1f28; color:white; border:1px solid #3a3a45;" onchange="saveSettings()">
                        <option value="right">Right Side</option>
                        <option value="left">Left Side</option>
                    </select>
                </label>
            </div>
        </div>
    `;
    document.body.appendChild(modalWrapper);
    setTimeout(applySettings, 100);
});

function openMailboxModal() { 
    document.getElementById('mailboxModal').classList.add('active'); 
    document.getElementById('mailboxContent').innerHTML = '<p style="color:#aaa;">Loading messages...</p>';
    setTimeout(loadMailboxMessages, 50); 
}
async function markAsRead(id, element) {
    try {
        await fetch('/api/mailbox/mark-read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messageIds: [id] }) });
        element.style.borderLeft = '1px solid #3a3a45'; // Remove unread highlight
        element.onclick = null;
        element.style.cursor = 'default';
        const badge = element.querySelector('.new-badge');
        if (badge) badge.style.display = 'none';
        fetchUnreadMailCount(); // Updates the top nav counter instantly
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
    container.innerHTML = '<p style="color:#aaa;">Loading profile...</p>';
    
    try {
        const res = await fetch(`/api/profile/${encodeURIComponent(query)}`);
        if (!res.ok) {
            container.innerHTML = '<p style="color:#ff5555;">User not found or is an external author.</p>';
            document.getElementById('upUsername').textContent = username || 'Unknown User';
            document.getElementById('upAvatar').src = '/Assets/placeholder.png';
            document.getElementById('upPoints').textContent = '0 pts';
            return;
        }
        
        const data = await res.json();
        const escapeTxt = (txt) => (txt || '').toString().replace(/[&<>"']/g, m => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[m]));
        
        document.getElementById('upUsername').textContent = data.username;
        document.getElementById('upAvatar').src = data.avatar ? `https://cdn.discordapp.com/avatars/${data.discordId}/${data.avatar}.png` : 'https://cdn.discordapp.com/embed/avatars/0.png';
        document.getElementById('upPoints').textContent = `${data.totalPoints} pts`;
        
        if (!data.contributions || data.contributions.length === 0) {
            container.innerHTML = '<p style="color:#888;">No approved contributions yet.</p>';
            return;
        }
        
        container.innerHTML = data.contributions.map(c => {
            const tabMap = { 'Guide': 'guides', 'Asset': 'assets', 'Community': 'communities', 'Mod': 'mods', 'Game': 'overview' };
            const tab = tabMap[c.category] || 'overview';
            const link = c.gameId ? `/games/${c.gameId}?tab=${tab}` : '/';
            return `
                <a href="${link}" style="display:flex; justify-content:space-between; align-items:center; background:#2a2a35; padding:12px; border:1px solid #3a3a45; border-radius:8px; margin-bottom:8px; text-decoration:none; color:white; transition:border 0.2s;" onmouseover="this.style.borderColor='#7A6BB5'" onmouseout="this.style.borderColor='#3a3a45'">
                    <div>
                        <div style="font-weight:bold; color:#9d8ec7; margin-bottom:4px;">${escapeTxt(c.target)}</div>
                        <div style="font-size:0.8em; color:#888;">${c.category} • ${c.gameId || 'General'}</div>
                    </div>
                    <span style="font-size:1.2em; color:#7A6BB5;">➔</span>
                </a>
            `;
        }).join('');
    } catch (e) { container.innerHTML = '<p style="color:#ff5555;">Failed to load profile.</p>'; }
}
function closeUserProfileModal() { document.getElementById('userProfileModal').classList.remove('active'); }

async function loadMailboxMessages() {
    const container = document.getElementById('mailboxContent');
    try {
        const res = await fetch('/api/mailbox');
        const mail = await res.json();
        if (!mail || mail.length === 0) { container.innerHTML = '<p style="color:#888; text-align:center;">Your mailbox is empty.</p>'; return; }
        
        container.innerHTML = mail.map(m => {
            let senderInfo = '';
            let statusBadge = '';
            
            if (m.direction === 'INBOUND') {
                const avatar = m.adminAvatar || 'https://cdn.discordapp.com/embed/avatars/0.png';
                const name = m.adminUsername || 'Admin';
                senderInfo = `<img src="${avatar}" style="width:20px;height:20px;border-radius:50%;vertical-align:middle;margin-right:5px; border: 1px solid #7A6BB5;"><b>${name}</b>`;
            } else if (m.direction === 'OUTBOUND_CONTRIBUTION') {
                senderInfo = `<b>📦 Contribution</b>`;
                const statusStr = (m.status || 'Pending').toUpperCase();
                const color = statusStr === 'APPROVED' ? '#4CAF50' : statusStr === 'REJECTED' ? '#F44336' : '#FFC107';
                statusBadge = `<span style="background:${color}; color:#000; padding:2px 6px; border-radius:10px; font-size:0.7em; font-weight:bold; margin-left:8px; vertical-align:middle;">${statusStr}</span>`;
            } else {
                senderInfo = `<b>📤 You</b>`;
            }

            const isUnread = !m.read && m.direction === 'INBOUND';
            const unreadHighlight = isUnread ? 'border-left: 4px solid #FF5E5B; cursor: pointer;' : 'border-left: 1px solid #3a3a45;';
            const newBadge = isUnread ? `<span class="new-badge" style="background:#FF5E5B; color:#fff; padding:2px 6px; border-radius:10px; font-size:0.7em; font-weight:bold; margin-left:8px; vertical-align:middle;">NEW</span>` : '';

            // Strict text escaping to prevent HTML/XSS execution inside the mailbox
            const escapeMail = (text) => (text || '').replace(/[&<>"']/g, match => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[match]));

            return `
            <div style="background:#1f1f28; border:1px solid #3a3a45; ${unreadHighlight} padding:12px; border-radius:8px; margin-bottom:10px;" ${isUnread ? `onclick="markAsRead('${m.id}', this)"` : ''}>
                <div style="display:flex; justify-content:space-between; font-size:0.85em; color:#aaa; margin-bottom:8px; align-items:center;">
                    <div>${senderInfo} — ${escapeMail(m.subject)} ${statusBadge} ${newBadge}</div>
                    <span>${new Date(m.date).toLocaleDateString()}</span>
                </div>
                <div style="color:#fff; font-size:0.95em; white-space:pre-wrap;">${escapeMail(m.content)}</div>
            </div>
            `;
        }).join('');
    } catch (e) { container.innerHTML = '<p style="color:#ff5555;">Failed to load mailbox.</p>'; }
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
    localStorage.setItem('nurture_settings', JSON.stringify({ showLb, lbSide }));
    applySettings();
}

function applySettings() {
    const raw = localStorage.getItem('nurture_settings');
    if (!raw) return;
    const { showLb, lbSide } = JSON.parse(raw);
    
    const lbEl = document.getElementById('leaderboardSidebar');
    const spacerEl = document.getElementById('lbSpacer'); // Grab the invisible spacer
    
    if (lbEl) {
        if (showLb) {
            lbEl.style.display = 'flex';
            if (spacerEl) spacerEl.style.display = 'block';
            
            // Swap both elements around the center content to maintain perfect symmetry
            if (lbSide === 'left') {
                lbEl.style.order = '-1';
                if (spacerEl) spacerEl.style.order = '1';
            } else {
                lbEl.style.order = '1';
                if (spacerEl) spacerEl.style.order = '-1';
            }
        } else {
            lbEl.style.display = 'none';
            if (spacerEl) spacerEl.style.display = 'none';
        }
    }

    const toggle = document.getElementById('toggleLeaderboard');
    const select = document.getElementById('selectLbSide');
    if (toggle) toggle.checked = showLb;
    if (select) select.value = lbSide;
}