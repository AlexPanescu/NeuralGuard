import { useState, useEffect, useCallback, useRef } from "react";
import apiClient from "../api/client";

export const useApi = (endpoint, options = {}) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const latestOptionsRef = useRef(options);

  useEffect(() => {
    latestOptionsRef.current = options;
  }, [options]);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await apiClient.get(endpoint, latestOptionsRef.current);
      setData(response.data);
    } catch (err) {
      setError(
        err.response?.data?.message ||
          err.response?.data?.error ||
          err.message ||
          "Eroare la incarcarea datelor",
      );
    } finally {
      setLoading(false);
    }
  }, [endpoint]);

  useEffect(() => {
    if (endpoint) {
      fetchData();
    }
  }, [endpoint, fetchData]);

  return { data, loading, error, refetch: fetchData };
};
