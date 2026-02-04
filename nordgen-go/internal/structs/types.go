package structs

type Server struct {
	Name    string
	Host    string
	IP      string
	Load    int
	Country string
	Code    string
	City    string
	Lat     float64
	Lon     float64
	PubK    string
	Dist    float64
}

type Preferences struct {
	DNS       string
	UseIP     bool
	Keepalive int
}

type Stats struct {
	Total    int
	Best     int
	Rejected int
}

type ApiLocation struct {
	Lat     float64 `json:"latitude"`
	Lon     float64 `json:"longitude"`
	Country struct {
		Name string `json:"name"`
		Code string `json:"code"`
		City struct {
			Name string `json:"name"`
		} `json:"city"`
	} `json:"country"`
}

type ApiTech struct {
	ID   string `json:"identifier"`
	Meta []struct {
		Name  string `json:"name"`
		Value string `json:"value"`
	} `json:"metadata"`
}

type ApiSpec struct {
	ID     string `json:"identifier"`
	Values []struct {
		Value string `json:"value"`
	} `json:"values"`
}

type ApiServer struct {
	Name      string        `json:"name"`
	Hostname  string        `json:"hostname"`
	Station   string        `json:"station"`
	Load      int           `json:"load"`
	Locations []ApiLocation `json:"locations"`
	Tech      []ApiTech     `json:"technologies"`
	Specs     []ApiSpec     `json:"specifications"`
}
