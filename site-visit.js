(() => {
    if (location.protocol !== "https:" && location.protocol !== "http:") return;
    const sentKey = "homeMadeCloudVisitSent";
    let visitId;
    try {
        if (sessionStorage.getItem(sentKey)) return;
        visitId = sessionStorage.getItem("homeMadeCloudVisitId");
        if (!visitId) {
            visitId = crypto.randomUUID();
            sessionStorage.setItem("homeMadeCloudVisitId", visitId);
        }
        sessionStorage.setItem(sentKey, "1");
    } catch { return; }
    fetch("/api/site-visit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        body: JSON.stringify({ visitId, page: location.pathname || "/" })
    }).catch(() => {});
})();
