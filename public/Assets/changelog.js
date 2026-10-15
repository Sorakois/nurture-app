// =========================================================================
// SITE CHANGELOGS — ADD NEW UPDATES AT THE VERY TOP OF THIS ARRAY
// The first item (index 0) is natively displayed. Every older item is 
// automatically pushed down into the "See older changelogs" archive.
// =========================================================================
const SITE_CHANGELOGS = [
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

function formatChangelogLine(line) {
    const safe = (line || '').replace(/[&<>"']/g, m => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[m]));
    
    // Automatically converts any leading [TAG] (e.g. [NEW], [MOBILE], [UI], [FIX]) into a badge
    return safe.replace(/^\[([A-Za-z0-9_-]+)\]\s*/, (match, tag) => {
        const tagClass = tag.toLowerCase();
        return `<span class="cl-tag ${tagClass}">${tag.toUpperCase()}</span>`;
    });
}

function buildChangelogEntryHtml(entry) {
    const itemsHtml = (entry.changes || []).map(c => `<li>${formatChangelogLine(c)}</li>`).join('');
    return `
        <div class="changelog-entry">
            <div class="changelog-entry-meta">
                <div class="changelog-version-title">
                    ${entry.version} — ${entry.title}
                </div>
                <span class="changelog-date">${entry.date}</span>
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

    if (!latestContainer || SITE_CHANGELOGS.length === 0) return;

    const newest = SITE_CHANGELOGS[0];
    if (headerVer) headerVer.textContent = `${newest.version} • ${newest.date}`;
    latestContainer.innerHTML = buildChangelogEntryHtml(newest);

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