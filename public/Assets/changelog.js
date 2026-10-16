// =========================================================================
// SITE CHANGELOGS — ADD NEW UPDATES AT THE VERY TOP OF THIS ARRAY
// The first item (index 0) is natively displayed. Every older item is 
// automatically pushed down into the "See older changelogs" archive.
// =========================================================================
const SITE_CHANGELOGS = [
    {
        version: "v1.0.1",
        date: "2026-10-16",
        title: "New 'My Stuff', Security, UI, and Coupon Fixes ",
        changes: [
            "[UI] Coupon overhaul: new interface",
            "[NEW] Account banning",
            "[UI] Grammar tweaks",
            "[UI] New Contributions UI (when you click your/a name)",
            "[NEW] 'My Stuff' - just see what you want/need to see!"
        ]
    },
    {
        version: "v1.0.0",
        date: "2026-10-15",
        title: "GUI Overhaul and Suggestions/Editing",
        changes: [
            "[NEW] You can now suggest for data to be changed! You get points the more you help.",
            "[NEW] You can now link your discord account to the website, needed to contribute.",
            "[NEW] Mobile Trophy button & popup leaderboard for mobile browsers.",
            "[NEW] Added a hero for changelogs.",
            "[NEW] Added a filter system for games in the main menu.",
            "[NEW] You can now 'favorite' games to add preference to what you want to use",
            "[NEW] New mailbox system, settings",
            "[MOBILE] COMPLETELY overhauled mobile for better looks and performance.",
            "[UI] Smoother performance while making the background more eye-appealing."
        ]
    }
];

const CHANGELOG_STORAGE_KEY = 'nurture_collapsed_changelog_id';

function formatReadableDate(dateInput) {
    if (!dateInput) return '';
    const months = ["Jan.", "Feb.", "Mar.", "Apr.", "May", "Jun.", "Jul.", "Aug.", "Sep.", "Oct.", "Nov.", "Dec."];
    
    // Parse YYYY-MM-DD directly to prevent UTC midnight timezone shift
    if (typeof dateInput === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateInput.trim())) {
        const [year, month, day] = dateInput.trim().split('-').map(Number);
        return `${months[month - 1]} ${day}, ${year}`;
    }

    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return String(dateInput);
    return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function getLatestChangelogId() {
    if (!SITE_CHANGELOGS || SITE_CHANGELOGS.length === 0) return '';
    return `${SITE_CHANGELOGS[0].version}_${SITE_CHANGELOGS[0].date}`;
}

function formatChangelogLine(line) {
    const safe = (line || '').replace(/[&<>"']/g, m => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[m]));
    
    return safe.replace(/^\[([A-Za-z0-9_-]+)\]\s*/, (match, tag) => {
        const tagClass = tag.toLowerCase();
        return `<span class="cl-tag ${tagClass}">${tag.toUpperCase()}</span>`;
    });
}

function buildChangelogEntryHtml(entry) {
    const itemsHtml = (entry.changes || []).map(c => `<li>${formatChangelogLine(c)}</li>`).join('');
    const formattedDate = formatReadableDate(entry.date);
    return `
        <div class="changelog-entry">
            <div class="changelog-entry-meta">
                <div class="changelog-version-title">
                    ${entry.version} — ${entry.title}
                </div>
                <span class="changelog-date">${formattedDate}</span>
            </div>
            <ul class="changelog-list">${itemsHtml}</ul>
        </div>
    `;
}

function initChangelogs() {
    const latestContainer = document.getElementById('latestChangelogContainer');
    const olderContainer = document.getElementById('olderChangelogsContainer');
    const olderBtn = document.getElementById('olderChangelogsBtn');
    const headerVer = document.getElementById('clHeaderVersion');
    const body = document.getElementById('changelogBody');
    const toggleBtn = document.getElementById('clToggleText');

    if (!latestContainer || SITE_CHANGELOGS.length === 0) return;

    const newest = SITE_CHANGELOGS[0];
    const readableNewestDate = formatReadableDate(newest.date);
    if (headerVer) headerVer.textContent = `${newest.version} • ${readableNewestDate}`;
    latestContainer.innerHTML = buildChangelogEntryHtml(newest);

    // Check if the user previously collapsed this exact changelog version
    const currentId = getLatestChangelogId();
    const collapsedId = localStorage.getItem(CHANGELOG_STORAGE_KEY);

    if (body && toggleBtn) {
        if (collapsedId === currentId) {
            body.classList.add('collapsed');
            toggleBtn.textContent = 'Expand ▼';
        } else {
            // New changelog detected (or never collapsed): expand by default
            body.classList.remove('collapsed');
            toggleBtn.textContent = 'Hide ▲';
        }
    }

    const olderList = SITE_CHANGELOGS.slice(1);
    if (olderList.length > 0 && olderContainer && olderBtn) {
        olderContainer.innerHTML = olderList.map(entry => buildChangelogEntryHtml(entry)).join('');
        olderBtn.style.display = 'flex';
        olderBtn.textContent = `See older changelogs (${olderList.length}) ▼`;
    } else if (olderBtn) {
        olderBtn.style.display = 'none';
    }
}

function toggleChangelogBox() {
    const body = document.getElementById('changelogBody');
    const btn = document.getElementById('clToggleText');
    if (!body || !btn) return;
    
    const isCollapsed = body.classList.toggle('collapsed');
    btn.textContent = isCollapsed ? 'Expand ▼' : 'Hide ▲';

    const currentId = getLatestChangelogId();
    const syncedValue = (isCollapsed && currentId) ? currentId : '';
    if (syncedValue) {
        localStorage.setItem(CHANGELOG_STORAGE_KEY, syncedValue);
    } else {
        localStorage.removeItem(CHANGELOG_STORAGE_KEY);
    }

    if (typeof window.syncUserPreferences === 'function') {
        window.syncUserPreferences({ collapsedChangelogId: syncedValue });
    }
}

function toggleOlderChangelogs() {
    const archive = document.getElementById('olderChangelogsContainer');
    const btn = document.getElementById('olderChangelogsBtn');
    if (!archive || !btn) return;
    const isOpen = archive.classList.toggle('open');
    const count = SITE_CHANGELOGS.length - 1;
    btn.textContent = isOpen ? 'Hide older changelogs ▲' : `See older changelogs (${count}) ▼`;
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initChangelogs);
} else {
    initChangelogs();
}