import axios from 'axios';

export async function fetchConfig(): Promise<string | null> {
  try {
    const response = await axios.get('/api/config');
    if (!response.data || response.data.trim() === '') {
      // No config received, server likely down
      return null;
    }
    return response.data;
  } catch (error) {
    // Server not reachable
    return null;
  }
}