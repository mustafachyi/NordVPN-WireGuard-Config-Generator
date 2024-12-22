require 'fileutils'
require 'net/http'
require 'json'
require 'logger'
require 'tty-prompt'
require 'uri'
require 'base64'
require 'time'
require 'io/console'

logger = Logger.new(STDOUT)
logger.level = Logger::INFO
logger.datetime_format = '%Y-%m-%d %H:%M:%S'

class Server
  attr_accessor :name, :hostname, :station, :load, :country, :city, :latitude, :longitude, :public_key, :distance

  def initialize(name, hostname, station, load, country, city, latitude, longitude, public_key, distance = 0)
    @name = name
    @hostname = hostname
    @station = station
    @load = load
    @country = country
    @city = city
    @latitude = latitude
    @longitude = longitude
    @public_key = public_key
    @distance = distance
  end
end

class UserConfig
  attr_accessor :dns, :use_ip, :keepalive

  def initialize(dns = "103.86.96.100", use_ip = false, keepalive = 25)
    @dns = dns
    @use_ip = use_ip
    @keepalive = keepalive
  end
end

def get_user_preferences
  prompt = TTY::Prompt.new
  dns = prompt.ask('Enter DNS server IP (default: 103.86.96.100):', default: '103.86.96.100') do |q|
    q.validate(/\A(?:\d{1,3}\.){3}\d{1,3}\z/, 'Please enter a valid IP address.')
  end

  use_ip = prompt.yes?('Use IP instead of hostname for endpoints?')

  keepalive = prompt.ask('Enter PersistentKeepalive value (default: 25):') do |q|
    q.default(25)
    q.validate { |v| 
      val = v.to_i
      val >= 15 && val <= 120 
    }
    q.messages[:valid?] = 'Keepalive must be between 15 and 120.'
  end

  UserConfig.new(dns, use_ip, keepalive.to_i)
end

def calculate_distance(ulat, ulon, slat, slon)
  rad = ->(deg) { deg * Math::PI / 180 }
  dlon = rad.call(slon - ulon)
  dlat = rad.call(slat - ulat)
  a = Math.sin(dlat / 2)**2 + Math.cos(rad.call(ulat)) * Math.cos(rad.call(slat)) * Math.sin(dlon / 2)**2
  c = 2 * Math.asin(Math.sqrt(a))
  c * 6371
end

def parse_server(server_data, user_location)
  ulat, ulon = user_location
  location = server_data['locations'].first
  tech = server_data['technologies'].find { |t| t['identifier'] == 'wireguard_udp' }
  metadata = tech ? tech['metadata'].find { |m| m['name'] == 'public_key' } : nil
  public_key = metadata ? metadata['value'] : nil
  return nil unless public_key

  distance = calculate_distance(ulat, ulon, location['latitude'], location['longitude'])
  Server.new(
    server_data['name'],
    server_data['hostname'],
    server_data['station'],
    server_data['load'].to_i,
    location['country']['name'],
    location['country']['city'] ? location['country']['city']['name'] : 'unknown',
    location['latitude'],
    location['longitude'],
    public_key,
    distance
  )
rescue
  nil
end

def is_valid_token(token)
  !!(token =~ /\A[a-fA-F0-9]{64}\z/)
end

class NordVPNConfigGenerator
  attr_accessor :concurrent_limit, :output_dir, :user_config, :logger

  def initialize(concurrent_limit = 200)
    @concurrent_limit = concurrent_limit
    @output_dir = nil
    @user_config = nil
    @logger = nil
  end

  def initialize_output_directory
    timestamp = Time.now.iso8601.gsub(/[:.]/, '_')
    @output_dir = File.join(__dir__, "nordvpn_configs_#{timestamp}")
    FileUtils.mkdir_p(@output_dir)
    @logger.info("Created output directory: #{@output_dir}")
  end

  def generate_configs(token, user_config, logger)
    @user_config = user_config
    @logger = logger

    unless is_valid_token(token)
      @logger.error("Invalid token format. Expected 64 character hex string.")
      return
    end

    @logger.info("Starting configuration generation...")

    begin
      key = get_private_key(token, logger)
      unless key
        @logger.error("Failed to get private key. Invalid token or API error.")
        return
      end

      initialize_output_directory

      servers = get_servers(logger)
      if servers.empty?
        @logger.error("Failed to get servers")
        return
      end
      @logger.info("Found #{servers.length} servers")

      location = get_location(logger)
      if location.nil?
        @logger.error("Failed to get location")
        return
      end
      @logger.info("Current location: #{location}")

      process_and_save(key, servers, location, logger)
      @logger.info("All configurations have been saved to: #{@output_dir}")
    rescue => e
      @logger.error("Error generating configs: #{e.message}")
    end
  end

  def get_private_key(token, logger)
    token_encoded = Base64.strict_encode64("token:#{token}")
    uri = URI('https://api.nordvpn.com/v1/users/services/credentials')
    req = Net::HTTP::Get.new(uri)
    req['Authorization'] = "Basic #{token_encoded}"

    response = Net::HTTP.start(uri.hostname, uri.port, use_ssl: true) { |http| http.request(req) }

    data = JSON.parse(response.body)
    data['nordlynx_private_key'] || nil
  rescue
    nil
  end

  def get_servers(logger)
    uri = URI('https://api.nordvpn.com/v1/servers')
    params = { limit: 7000, 'filters[servers_technologies][identifier]' => 'wireguard_udp' }
    uri.query = URI.encode_www_form(params)

    response = Net::HTTP.get_response(uri)
    JSON.parse(response.body)
  rescue
    []
  end

  def get_location(logger)
    uri = URI('https://ipinfo.io/json')
    response = Net::HTTP.get_response(uri)
    data = JSON.parse(response.body)
    loc = data['loc'].split(',').map(&:to_f)
    loc.size == 2 ? loc : nil
  rescue
    nil
  end

  def generate_config(key, server)
    endpoint = @user_config.use_ip ? server.station : server.hostname
    <<~CONFIG
      [Interface]
      PrivateKey = #{key}
      Address = 10.5.0.2/16
      DNS = #{@user_config.dns}

      [Peer]
      PublicKey = #{server.public_key}
      AllowedIPs = 0.0.0.0/0, ::/0
      Endpoint = #{endpoint}:51820
      PersistentKeepalive = #{@user_config.keepalive}
    CONFIG
  end

  def sanitize_name(name)
    sanitized = name.downcase
    sanitized.gsub!(/\s+/, '_')
    sanitized.gsub!(/(\d+)/, '_\1')
    sanitized.gsub!(/and/, '_and_')
    sanitized.gsub!(/_{2,}/, '_')
    sanitized.gsub!(/[^a-z0-9_]/, '_')
    sanitized.gsub!(/_{2,}/, '_')
    sanitized.gsub!(/^_+|_+$/, '')
    sanitized
  end

  def save_config(key, server, base_path)
    config = generate_config(key, server)
    country = sanitize_name(server.country)
    city = sanitize_name(server.city)
    name = sanitize_name(server.name)

    dir_path = File.join(@output_dir, base_path, country, city)
    FileUtils.mkdir_p(dir_path)

    file_path = File.join(dir_path, "#{name}.conf")
    File.write(file_path, config)
  end

  def process_and_save(private_key, servers, location, logger)
    @logger.info("Processing server information...")
    parsed_servers = servers.map { |s| parse_server(s, location) }.compact
    @logger.info("Successfully processed #{parsed_servers.length} servers")

    sorted_servers = parsed_servers.sort_by { |s| [s.load, s.distance] }

    @logger.info("Generating standard configurations...")
    sorted_servers.each do |server|
      save_config(private_key, server, 'configs')
    end

    @logger.info("Generating optimized configurations...")
    best_servers = {}
    sorted_servers.each do |server|
      key = "#{server.country}_#{server.city}"
      if best_servers[key].nil? || server.load < best_servers[key].load
        best_servers[key] = server
      end
    end

    best_servers.values.each do |server|
      save_config(private_key, server, 'best_configs')
    end

    @logger.info("Saving server information...")
    servers_info = {}
    sorted_servers.each do |server|
      servers_info[server.country] ||= {}
      servers_info[server.country][server.city] ||= { distance: server.distance.round, servers: [] }
      servers_info[server.country][server.city][:servers] << [server.name, server.load]
    end

    servers_json_path = File.join(@output_dir, 'servers.json')
    File.write(servers_json_path, JSON.pretty_generate(servers_info))
  end
end

def validate_token(token, logger)
  generator = NordVPNConfigGenerator.new
  generator.logger = logger
  generator.get_private_key(token, logger)
end

def clear_console
  system('cls') || system('clear')
end

def display_header
  clear_console
  puts "\nNordVPN Configuration Generator"
  puts "=============================="
  puts
end

def get_valid_token(prompt)
  loop do
    display_header
    token = prompt.mask('Please enter your access token (64 character hex string):')

    if token =~ /\A[a-fA-F0-9]{64}\z/
      return token
    else
      puts "\n>> Invalid token format. Please ensure your token is a 64-character hexadecimal string."
      puts "Press Enter to retry or Ctrl+C to exit..."
      gets
      clear_console
    end
  end
end

def main
  prompt = TTY::Prompt.new
  token = get_valid_token(prompt)

  logger = Logger.new(STDOUT)
  logger.level = Logger::INFO
  logger.datetime_format = '%Y-%m-%d %H:%M:%S'

  display_header
  logger.info("Validating access token...")
  private_key = validate_token(token, logger)
  
  if private_key
    logger.info("Access token is valid.")
    
    puts "\n"

    user_config = get_user_preferences
  else
    logger.error("Invalid token or API error. Could not retrieve private key.")
    puts "\nPress Enter to try again or Ctrl+C to exit..."
    gets
    return main
  end

  start_time = Time.now
  generator = NordVPNConfigGenerator.new
  generator.generate_configs(token, user_config, logger)
  elapsed_time = Time.now - start_time

  if generator.output_dir
    logger.info("Process completed in #{elapsed_time.round(2)} seconds")
  else
    logger.error("Process failed - no configurations were generated")
  end
end

main