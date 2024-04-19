require 'net/http'
require 'uri'
require 'base64'
require 'json'
require 'oj'
require 'fileutils'

def get_key(token)
  begin
    encoded_token = Base64.strict_encode64("token:#{token}")
    uri = URI.parse("https://api.nordvpn.com/v1/users/services/credentials")
    http = Net::HTTP.new(uri.host, uri.port)
    http.use_ssl = true
    request = Net::HTTP::Get.new(uri.request_uri, 'Authorization' => "Basic #{encoded_token}")
    response = http.request(request)
    return Oj.load(response.body)['nordlynx_private_key']
  rescue => error
    if error.respond_to?(:response)
      puts "Http Error: #{error.response}"
    elsif error.respond_to?(:request)
      puts "Error Connecting: #{error.request}"
    elsif error.respond_to?(:message)
      puts "Timeout Error: #{error.message}"
    else
      puts "Something went wrong: #{error}"
    end
  end
end

def get_servers
  begin
    uri = URI.parse("https://api.nordvpn.com/v1/servers?limit=7000&filters[servers_technologies][identifier]=wireguard_udp")
    http = Net::HTTP.new(uri.host, uri.port)
    http.use_ssl = true
    request = Net::HTTP::Get.new(uri.request_uri)
    response = http.request(request)
    return Oj.load(response.body)
  rescue => error
    puts "Error occurred: #{error}"
    raise error
  end
end

def find_key(server)
  server['technologies'].each do |tech|
    if tech['identifier'] == 'wireguard_udp'
      (tech['metadata'] || []).each do |data|
        if data['name'] == 'public_key'
          return data['value']
        end
      end
    end
  end
  nil
end

def format_name(name)
  name.gsub(' ', '_')
end

def generate_config(key, server)
  public_key = find_key(server)
  if public_key
    country_name = format_name(server['locations'][0]['country']['name'])
    city_name = format_name(server['locations'][0]['country']['city']&.fetch('name', 'Unknown'))
    server_name = format_name("#{server['name'].gsub('#', '')}_#{city_name}")
    config = "
[Interface]
PrivateKey = #{key}
Address = 10.5.0.2/16
DNS = 103.86.96.100

[Peer]
PublicKey = #{public_key}
AllowedIPs = 0.0.0.0/0, ::/0
Endpoint = #{server['station']}:51820
PersistentKeepalive = 25
"
    return { 'countryName' => country_name, 'cityName' => city_name, 'serverName' => server_name, 'config' => config }
  else
    puts "No WireGuard public key found for #{server['name']} in #{server['city']&.fetch('name', 'Unknown')}. Skipping."
  end
end

def save_config(key, server, file_path = nil)
  begin
    if server.key?('locations')
      result = generate_config(key, server)
      if result
        country_name = result['countryName']
        city_name = result['cityName']
        server_name = result['serverName']
        config = result['config']
        if file_path.nil?
          country_path = File.join('configs', country_name)
          FileUtils.mkdir_p(country_path)
          city_path = File.join(country_path, city_name)
          FileUtils.mkdir_p(city_path)
          filename = "#{server_name}.conf"
          file_path = File.join(city_path, filename)
        end
        File.write(file_path, config)
        puts "WireGuard configuration for #{server_name} saved to #{file_path}"
        return file_path
      end
    end
  rescue => error
    puts "Error occurred while saving config: #{error}"
  end
end

def calculate_distance(ulat, ulon, slat, slon)
  dlon = slon - ulon
  dlat = slat - ulat
  a = Math.sin(dlat/2)**2 + Math.cos(ulat) * Math.cos(slat) * Math.sin(dlon/2)**2
  c = 2 * Math.asin(Math.sqrt(a))
  return c * 6371
end

def sort_servers(servers, ulat, ulon)
  servers.each do |server|
    slat = server['locations'][0]['latitude']
    slon = server['locations'][0]['longitude']
    server['distance'] = calculate_distance(ulat, ulon, slat, slon)
  end
  return servers.sort_by { |server| [server['load'], server['distance']] }
end

def get_location
  begin
    uri = URI.parse('https://ipinfo.io/json')
    http = Net::HTTP.new(uri.host, uri.port)
    http.use_ssl = true
    request = Net::HTTP::Get.new(uri.request_uri)
    response = http.request(request)
    location = Oj.load(response.body)['loc'].split(',')
    return [location[0].to_f, location[1].to_f]
  rescue => error
    puts "Error occurred: #{error}"
    raise error
  end
end

def main
  print 'Please enter your token: '
  token = gets.chomp
  key = get_key(token)
  servers = get_servers
  ulat, ulon = get_location
  sorted_servers = sort_servers(servers, ulat, ulon)
  paths = sorted_servers.map { |server| save_config(key, server) }

  servers_by_location = {}
  sorted_servers.each do |server|
    country = server['locations'][0]['country']['name']
    city = server['locations'][0]['country']['city']['name']
    servers_by_location[country] ||= {}
    servers_by_location[country][city] ||= { 'distance' => server['distance'].round, 'servers' => [] }
    server_info = [server['name'], "load: #{server['load']}"]
    servers_by_location[country][city]['servers'] << server_info
  end

  servers_by_location = servers_by_location.sort.to_h
  servers_by_location.each do |country, cities|
    servers_by_location[country] = cities.sort.to_h
  end

  FileUtils.mkdir_p('best_configs')
  servers_by_location.each do |country, cities|
    cities.each do |city, info|
      best_server = info['servers'][0]
      best_server_info = sorted_servers.find { |server| server['name'] == best_server[0] }
      safe_country_name = format_name(country)
      safe_city_name = format_name(city)
      save_config(key, best_server_info, File.join('best_configs', "#{safe_country_name}_#{safe_city_name}.conf"))
    end
  end

  data = JSON.pretty_generate(servers_by_location)

  File.open('servers.json', 'w') do |f|
    f.write("{\n")
    last_country_index = servers_by_location.keys.length - 1
    servers_by_location.each_with_index do |(country, cities), index|
      f.write("  \"#{country}\": {\n")
      last_city_index = cities.keys.length - 1
      cities.each_with_index do |(city, data), city_index|
        f.write("    \"#{city}\": {\n")
        f.write("      \"distance\": #{data['distance']},\n")
        f.write("      \"servers\": [\n")
        last_server_index = data['servers'].length - 1
        data['servers'].each_with_index do |server, server_index|
          f.write("        [\"#{server[0]}\", #{server[1]}]")
          f.write(",\n") if server_index < last_server_index
        end
        f.write("\n      ]\n")
        f.write("    }")
        f.write(",\n") if city_index < last_city_index
      end
      f.write("\n  }")
      f.write(",\n") if index < last_country_index
    end
    f.write("\n}\n")
  end
end

begin
  main
rescue => error
  puts "Error occurred: #{error}"
end