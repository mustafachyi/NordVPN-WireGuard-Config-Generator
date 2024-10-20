document.addEventListener('DOMContentLoaded', () => {
  const configTemplate = `[Interface]
PrivateKey = YOUR_PRIVATE_KEY_HERE
Address = 10.5.0.2/16
DNS = 103.86.96.100

[Peer]
PublicKey = {{publicKey}}
AllowedIPs = 0.0.0.0/0, ::/0
Endpoint = {{station}}:51820
PersistentKeepalive = 25
  `;

  let serversData = {};
  let currentCountry = '';
  let currentCity = '';
  let sortOrder = 'alphabetical';
  let displayedServers = [];
  const serversPerPage = 100;

  async function fetchConfigs() {
    try {
      const response = await fetch('/nordvpn-servers');
      serversData = await response.json();
      populateCountryDropdown();
      updateServerCount();
      displayServers();
    } catch (error) {
      console.error('Error fetching configs:', error);
      document.getElementById('server-count').textContent = 'Error loading server data';
    }
  }

  function populateCountryDropdown() {
    const countrySelect = document.getElementById('country-select');
    const countries = Object.keys(serversData).sort();

    countries.forEach(country => {
      const option = document.createElement('option');
      option.value = country;
      option.textContent = country;
      countrySelect.appendChild(option);
    });

    countrySelect.addEventListener('change', () => {
      currentCountry = countrySelect.value;
      currentCity = '';
      populateCityDropdown(currentCountry);
      resetDisplayedServers();
      displayServers(currentCountry);
      updateServerCount(currentCountry);
    });
  }

  function populateCityDropdown(country) {
    const citySelect = document.getElementById('city-select');
    citySelect.innerHTML = '';

    if (country) {
      const cities = Object.keys(serversData[country]).sort();
      citySelect.style.display = 'inline-block';

      if (cities.length > 1) {
        const allCitiesOption = document.createElement('option');
        allCitiesOption.value = '';
        allCitiesOption.textContent = 'All Cities';
        citySelect.appendChild(allCitiesOption);
      }

      cities.forEach(city => {
        const option = document.createElement('option');
        option.value = city;
        option.textContent = city;
        citySelect.appendChild(option);
      });

      citySelect.disabled = false;
      citySelect.value = '';

      citySelect.addEventListener('change', () => {
        currentCity = citySelect.value;
        resetDisplayedServers();
        displayServers(currentCountry, currentCity);
        updateServerCount(currentCountry, currentCity);
      });

      if (cities.length === 1) {
        citySelect.value = cities[0];
        currentCity = cities[0];
        resetDisplayedServers();
        displayServers(currentCountry, currentCity);
        updateServerCount(currentCountry, currentCity);
      }
    } else {
      citySelect.style.display = 'none';
    }
  }

  function resetDisplayedServers() {
    displayedServers = [];
    document.getElementById('config-list').innerHTML = '';
    document.getElementById('show-more').style.display = 'none';
  }

  function displayServers(country = '', city = '') {
    const configList = document.getElementById('config-list');
    const servers = getServers(country, city);

    if (sortOrder === 'alphabetical') {
      servers.sort((a, b) => a.originalName.localeCompare(b.originalName));
    } else {
      servers.sort((a, b) => sortOrder === 'asc' ? a.load - b.load : b.load - a.load);
    }

    const start = displayedServers.length;
    const end = Math.min(start + serversPerPage, servers.length);
    const newServers = servers.slice(start, end);

    const fragment = document.createDocumentFragment();
    newServers.forEach(server => {
      const row = document.createElement('tr');
      const nameCell = document.createElement('td');
      const loadCell = document.createElement('td');
      const actionCell = document.createElement('td');
      const downloadButton = document.createElement('button');

      nameCell.textContent = server.originalName;
      loadCell.textContent = `${server.load}%`;
      downloadButton.textContent = 'Download';
      downloadButton.className = 'retro-button text-sm md:text-base w-auto';
      downloadButton.onclick = () => downloadConfig(server.formattedName, server.station, server.publicKey);

      actionCell.appendChild(downloadButton);
      row.appendChild(nameCell);
      row.appendChild(loadCell);
      row.appendChild(actionCell);
      fragment.appendChild(row);
    });
    configList.appendChild(fragment);

    displayedServers = displayedServers.concat(newServers);

    const showMoreButton = document.getElementById('show-more');
    if (displayedServers.length < servers.length) {
      showMoreButton.style.display = 'block';
      showMoreButton.textContent = 'Show More';
    } else {
      showMoreButton.style.display = 'none';
    }
  }

  function getServers(country = '', city = '') {
    if (country && city) {
      return serversData[country][city] || [];
    } else if (country) {
      return Object.values(serversData[country]).flat();
    } else {
      return Object.values(serversData).flatMap(countryData => Object.values(countryData).flat());
    }
  }

  function updateServerCount(country = '', city = '') {
    const serverCount = document.getElementById('server-count');
    const count = getServers(country, city).length;
    serverCount.textContent = 'Total Servers: ' + count;
  }

  function downloadConfig(formattedName, station, publicKey) {
    const configContent = configTemplate
      .replace('{{publicKey}}', publicKey)
      .replace('{{station}}', station);

    const blob = new Blob([configContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = formattedName + '.conf';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  document.getElementById('sort-asc').addEventListener('click', () => {
    sortOrder = 'asc';
    resetDisplayedServers();
    displayServers(currentCountry, currentCity);
  });

  document.getElementById('sort-desc').addEventListener('click', () => {
    sortOrder = 'desc';
    resetDisplayedServers();
    displayServers(currentCountry, currentCity);
  });

  document.getElementById('show-more').addEventListener('click', () => {
    displayServers(currentCountry, currentCity);
  });

  document.getElementById('download-all').addEventListener('click', async () => {
    try {
      const response = await fetch('/download-all');
      const blob = await response.blob();
      saveAs(blob, 'nordvpn_configs.zip');
    } catch (error) {
      console.error('Error downloading all configs:', error);
    }
  });

  fetchConfigs();
});