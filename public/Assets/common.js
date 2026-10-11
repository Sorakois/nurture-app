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

    container.innerHTML = `
        <div class="user-profile-badge">
            <img src="${avatarUrl}" alt="Avatar" class="user-avatar">
            <span class="user-name">${user.username}</span>
            <a href="/auth/logout" class="sign-out-btn" onclick="clearCachedAuth()">Sign Out</a>
        </div>
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

document.addEventListener('DOMContentLoaded', initAuth);