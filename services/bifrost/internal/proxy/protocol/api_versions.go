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

// EncodeFlexible encodes the ApiVersions response using v3+ flexible format.
// v3+ uses compact arrays and tagged fields.
func (r *ApiVersionsResponse) EncodeFlexible() ([]byte, error) {
	// Calculate size needed:
	// - error_code: 2 bytes
	// - api_versions: varint length + (api_key:2 + min:2 + max:2 + tagged_fields:1) * N
	// - throttle_time_ms: 4 bytes
	// - tagged_fields: 1 byte (empty)

	// Use a buffer
	buf := make([]byte, 0, 256)

	// Error code (int16)
	buf = append(buf, byte(r.Err>>8), byte(r.Err))

	// Compact array: length+1 as unsigned varint
	buf = appendUvarint(buf, uint64(len(r.ApiVersions)+1))

	// Each API version entry
	for _, v := range r.ApiVersions {
		buf = append(buf, byte(v.ApiKey>>8), byte(v.ApiKey))
		buf = append(buf, byte(v.MinVersion>>8), byte(v.MinVersion))
		buf = append(buf, byte(v.MaxVersion>>8), byte(v.MaxVersion))
		buf = append(buf, 0) // Empty tagged fields for this entry
	}

	// Throttle time (int32)
	buf = append(buf, byte(r.ThrottleMs>>24), byte(r.ThrottleMs>>16), byte(r.ThrottleMs>>8), byte(r.ThrottleMs))

	// Empty tagged fields at end
	buf = append(buf, 0)

	return buf, nil
}

// appendUvarint appends an unsigned varint to the buffer.
func appendUvarint(buf []byte, x uint64) []byte {
	for x >= 0x80 {
		buf = append(buf, byte(x)|0x80)
		x >>= 7
	}
	return append(buf, byte(x))
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
