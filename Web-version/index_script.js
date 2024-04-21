SERVERS_URL = "https://corsproxy.io/?https://api.nordvpn.com/v1/servers?limit=7000&filters[servers_technologies][identifier]=wireguard_udp";
let originalServers = [],
    servers = [],
    currentPage = 0;
const pageSize = 50;

function populateCountryFilter() {
    let e = document.getElementById("country"),
        t = document.createElement("option");
    t.textContent = "All Countries", t.value = "all", e.appendChild(t);
    let r = [...new Set(originalServers.map(e => e.locations[0].country.name))];
    r.sort().forEach(t => {
        let r = document.createElement("option");
        r.textContent = t, r.value = t, e.appendChild(r)
    })
}

function populateCityFilter(country) {
    let e = document.getElementById("city");
    // Clear the city dropdown
    e.innerHTML = '';
    let cities = [...new Set(originalServers.filter(s => s.locations[0].country.name === country).map(e => e.locations[0].country.city.name))];
    if (cities.length > 1) {
        let t = document.createElement("option");
        t.textContent = "All Cities", t.value = "all", e.appendChild(t);
    }
    cities.sort().forEach(t => {
        let r = document.createElement("option");
        r.textContent = t, r.value = t, e.appendChild(r)
    })
    e.style.display = 'block';
    // If there's only one city, select it directly
    if (cities.length === 1) {
        e.value = cities[0];
        filterServersByCity();
    }
}

function filterServersByCountry() {
    clearTable();
    let e = document.getElementById("country").value;
    "all" === e ? (servers = [...originalServers]).sort((e, t) => e.name.localeCompare(t.name)) : servers = originalServers.filter(t => t.locations[0].country.name === e), currentPage = 0, displayServers()
}

function filterServersByCity() {
    clearTable();
    let e = document.getElementById("city").value;
    let country = document.getElementById("country").value;
    "all" === e ? servers = originalServers.filter(t => t.locations[0].country.name === country) : servers = originalServers.filter(t => t.locations[0].country.city.name === e), currentPage = 0, displayServers()
}

function sortServersByLoad(e) {
    servers = [...servers].sort((t, r) => "asc" === e ? t.load - r.load : r.load - t.load), currentPage = 0, displayServers()
}

function clearTable() {
    let e = document.getElementById("servers");
    for (; e.rows.length > 1;) e.deleteRow(1)
}

function displayServers() {
    let e = 50 * currentPage,
        t = servers.slice(e, e + 50),
        r = document.createDocumentFragment();
    t.forEach(e => {
        let t = document.createElement("tr");
        t.insertCell(0).textContent = e.name, t.insertCell(1).textContent = e.load;
        let n = document.createElement("a");
        n.textContent = "Download Config", n.href = createConfigBlobURL(e);
        let o = e.name.replace(/ /g, "_").replace(/-/g, "").replace(/__/g, "_").replace(/#/g, "");
        n.download = `${o}.conf`, t.insertCell(2).appendChild(n), r.appendChild(t)
    }), document.getElementById("servers").appendChild(r), currentPage++
}

function createConfigBlobURL(e) {
    let t = findKey(e),
        r = `
[Interface]
PrivateKey = YOUR_PRIVATE_KEY_HERE
Address = 10.5.0.2/16
DNS = 103.86.96.100

[Peer]
PublicKey = ${t}
AllowedIPs = 0.0.0.0/0, ::/0
Endpoint = ${e.station}:51820
PersistentKeepalive = 25
`,
        n = new Blob([r], {
            type: "text/plain"
        });
    return URL.createObjectURL(n)
}

function findKey(e) {
    for (let t of e.technologies)
        if ("wireguard_udp" === t.identifier) {
            for (let r of t.metadata)
                if ("public_key" === r.name) return r.value
        } return ""
}

fetch(SERVERS_URL).then(e => e.json()).then(e => {
    (originalServers = e).sort((e, t) => e.name.localeCompare(t.name)), servers = [...originalServers], populateCountryFilter(), displayServers()
});

document.getElementById("country").addEventListener("change", function() {
    let selectedCountry = this.value;
    if (selectedCountry === 'all') {
        document.getElementById("city").style.display = 'none';
    } else {
        populateCityFilter(selectedCountry);
    }
    filterServersByCountry();
});

document.getElementById("city").addEventListener("change", filterServersByCity);

document.getElementById("sortLoadAsc").addEventListener("click", () => {
    clearTable(), sortServersByLoad("asc")
});

document.getElementById("sortLoadDesc").addEventListener("click", () => {
    clearTable(), sortServersByLoad("desc")
});

document.getElementById("loadMore").addEventListener("click", () => {
    if (50 * currentPage < servers.length) displayServers();
    else {
        let e = document.getElementById("loadMore");
        e.textContent = "No more servers to show", e.style.backgroundColor = "#f44336", setTimeout(() => {
            e.textContent = "Load More", e.style.backgroundColor = "#4CAF50"
        }, 3e3)
    }
});
