import React, { useEffect, useState } from 'react';
import { fetchConfig } from '../api/configApi';
import { parseConfig, Config } from '../utils/configLoader';

export default function ConfigLoader() {
  const [config, setConfig] = useState<Config | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchConfig().then((yamlText) => {
      if (!yamlText) {
        setError('Cannot connect to server. Please ensure the backend is running.');
        return;
      }
      try {
        setConfig(parseConfig(yamlText));
      } catch (e) {
        setError('Failed to parse configuration.');
      }
    });
  }, []);

  if (error) {
    return <div style={{ color: 'red' }}>{error}</div>;
  }

  // ...existing code to render config...
}