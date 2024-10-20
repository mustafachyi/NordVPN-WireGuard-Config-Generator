const generateHTML = () => `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>NordVPN Configs</title>
    <link rel="icon" href="/favicon.ico" type="image/x-icon">
    <link href="/tailwind.min.css" rel="stylesheet">
    <style>
      body{font:16px/1.5 "Trebuchet MS",Arial,sans-serif;background:#1b2838;color:#c7d5e0;margin:0;padding:20px;overflow-y:scroll;}
      body::-webkit-scrollbar,select::-webkit-scrollbar{width:0;height:0;}
      body,select{-ms-overflow-style:none;} /* IE and Edge */
      *{scrollbar-width:none;} /* Firefox */
      .retro-button{background:linear-gradient(to bottom,#3a4f63,#1b2838);border:1px solid #000;border-radius:5px;box-shadow:2px 2px 5px #000;color:#c7d5e0;padding:5px 10px;text-shadow:1px 1px 2px #000;}
      .retro-button:hover{background:linear-gradient(to bottom,#4a5f73,#2b3848);}
      .retro-select{background:#1b2838;border:1px solid #000;border-radius:5px;color:#c7d5e0;padding:5px;text-shadow:1px 1px 2px #000;}
      .retro-container{border:1px solid #000;border-radius:5px;box-shadow:2px 2px 5px #000;padding:10px;background:#2b3848;}
      .retro-table{width:100%;border-collapse:collapse;margin-top:20px;}
      .retro-table th,.retro-table td{border:1px solid #000;padding:10px;text-align:left;}
      .retro-table th{background:#3a4f63;color:#c7d5e0;text-shadow:1px 1px 2px #000;}
      .retro-table td{background:#2b3848;color:#c7d5e0;text-shadow:1px 1px 2px #000;}
    </style>
  </head>
  <body>
    <div id="header" class="retro-container flex flex-wrap justify-between items-center mb-5 px-2 md:px-0">
      <div class="flex flex-wrap items-center space-x-2 space-y-2 md:space-y-0 md:flex-nowrap w-full md:w-auto">
        <select id="country-select" class="retro-select text-sm md:text-base w-auto">
          <option value="">All Countries</option>
        </select>
        <select id="city-select" class="retro-select text-sm md:text-base w-auto" style="display:none;">
          <option value="">All Cities</option>
        </select>
        <button id="sort-asc" class="retro-button text-sm md:text-base w-auto">Sort by Load (Asc)</button>
        <button id="sort-desc" class="retro-button text-sm md:text-base w-auto">Sort by Load (Desc)</button>
        <button id="download-all" class="retro-button text-sm md:text-base w-auto">Download All</button>
        <button onclick="window.open('https://github.com/mustafachyi/NordVPN-WireGuard-Config-Generator', '_blank')" class="retro-button text-sm md:text-base w-auto">Star on GitHub</button>
        <button onclick="window.open('https://ref.nordvpn.com/MXIVDoJGpKT', '_blank')" class="retro-button text-sm md:text-base w-auto">Get Nord</button>
      </div>
      <p id="server-count" class="retro-button text-sm md:text-base mt-2 md:mt-0 w-full md:w-auto text-center md:text-left">Loading...</p>
    </div>
    <table class="retro-table">
      <thead>
        <tr>
          <th>Server Name</th>
          <th>Load</th>
          <th>Action</th>
        </tr>
      </thead>
      <tbody id="config-list"></tbody>
    </table>
    <button id="show-more" class="retro-button text-sm md:text-base mt-5 w-full md:w-auto" style="display:none;">Show More</button>
    <script src="/FileSaver.min.js"></script>
    <script src="/clientScript.js"></script>
  </body>
  </html>
`;

module.exports = generateHTML;