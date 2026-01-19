package protocol

// ApiVersionsRequest is the request for ApiVersions API (key=18).
// For our use case in pre-auth phase, we only need to decode enough to get the correlation ID.
type ApiVersionsRequest struct {
}

func (r *ApiVersionsRequest) encode(pe packetEncoder) error {
	return nil
}

func (r *ApiVersionsRequest) decode(pd packetDecoder) error {
	return nil
}

func (r *ApiVersionsRequest) key() int16 {
	return 18
}

func (r *ApiVersionsRequest) version() int16 {
	return 0
}

// ApiVersionsResponseKey represents a single API version entry.
type ApiVersionsResponseKey struct {
	ApiKey     int16
	MinVersion int16
	MaxVersion int16
}

// ApiVersionsResponse is the response for ApiVersions API.
type ApiVersionsResponse struct {
	Err         KError
	ApiVersions []ApiVersionsResponseKey
	ThrottleMs  int32
}

func (r *ApiVersionsResponse) encode(pe packetEncoder) error {
	// Error code
	pe.putInt16(int16(r.Err))

	// Array of API versions
	if err := pe.putArrayLength(len(r.ApiVersions)); err != nil {
		return err
	}
	for _, v := range r.ApiVersions {
		pe.putInt16(v.ApiKey)
		pe.putInt16(v.MinVersion)
		pe.putInt16(v.MaxVersion)
	}

	return nil
}

func (r *ApiVersionsResponse) decode(pd packetDecoder) error {
	errCode, err := pd.getInt16()
	if err != nil {
		return err
	}
	r.Err = KError(errCode)

	n, err := pd.getInt32()
	if err != nil {
		return err
	}

	r.ApiVersions = make([]ApiVersionsResponseKey, n)
	for i := range r.ApiVersions {
		r.ApiVersions[i].ApiKey, err = pd.getInt16()
		if err != nil {
			return err
		}
		r.ApiVersions[i].MinVersion, err = pd.getInt16()
		if err != nil {
			return err
		}
		r.ApiVersions[i].MaxVersion, err = pd.getInt16()
		if err != nil {
			return err
		}
	}

	return nil
}
