// Background Animation Logic (GSAP 3)
function animateWithRandomNumber(myClass, from, to) {
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

// Persistent Discord Auth Check
async function checkAuth() {
    try {
        const response = await fetch('/api/auth/me');
        const data = await response.json();
        const authContainer = document.getElementById('authContainer');
        if (!authContainer) return;

        if (data.authenticated) {
            const avatarUrl = data.user.avatar 
                ? `https://cdn.discordapp.com/avatars/${data.user.discordId}/${data.user.avatar}.png` 
                : 'https://cdn.discordapp.com/embed/avatars/0.png'; 

            authContainer.innerHTML = `
                <div class="user-badge">
                    <img src="${avatarUrl}" alt="Avatar">
                    <span class="user-badge-name">${data.user.username}</span>
                    <a href="/auth/logout" class="user-logout-link" title="Logout">[X]</a>
                </div>
                <a href="https://ko-fi.com/sorakoi" class="social-button kofi-button">
                    <img src="/Assets/kofi_icon.png" alt="Ko-fi Icon">
                    <span class="sub-text">Ko-fi</span>
                </a>
            `;
        }
    } catch (err) {
        console.error("Auth check failed:", err);
    }
}

document.addEventListener('DOMContentLoaded', checkAuth);