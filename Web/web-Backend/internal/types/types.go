package types

type ConfigRequest struct {
	Token      string `json:"token"`
	Country    string `json:"country"`
	City       string `json:"city"`
	Name       string `json:"name"`
	PrivateKey string `json:"privateKey"`
	DNS        string `json:"dns"`
	Endpoint   string `json:"endpoint"`
	KeepAlive  *int   `json:"keepalive"`
}

type BatchConfigReq struct {
	Token      string `json:"token"`
	PrivateKey string `json:"privateKey"`
	DNS        string `json:"dns"`
	Endpoint   string `json:"endpoint"`
	KeepAlive  *int   `json:"keepalive"`
	Country    string `json:"country"`
	City       string `json:"city"`
}

type ValidatedConfig struct {
	Name       string
	PrivateKey string
	DNS        string
	UseStation bool
	KeepAlive  int
}

type ServerLoc struct {
	Country struct {
		Name string `json:"name"`
		Code string `json:"code"`
		City struct {
			Name string `json:"name"`
		} `json:"city"`
	} `json:"country"`
}

type ServerTech struct {
	ID       string `json:"identifier"`
	Metadata []struct {
		Name  string `json:"name"`
		Value string `json:"value"`
	} `json:"metadata"`
}

type ServerSpec struct {
	ID     string `json:"identifier"`
	Values []struct {
		Value string `json:"value"`
	} `json:"values"`
}

type RawServer struct {
	Name           string       `json:"name"`
	Station        string       `json:"station"`
	Hostname       string       `json:"hostname"`
	Load           int          `json:"load"`
	Locations      []ServerLoc  `json:"locations"`
	Technologies   []ServerTech `json:"technologies"`
	Specifications []ServerSpec `json:"specifications"`
}

type ProcessedServer struct {
	Name     string
	Station  string
	Hostname string
	Country  string
	City     string
	Code     string
	KeyID    int
}

type ServerPayload struct {
	Headers []string                              `json:"h"`
	List    map[string]map[string][][]interface{} `json:"l"`
}

type Asset struct {
	Content []byte
	Brotli  []byte
	Mime    string
	Etag    string
}
