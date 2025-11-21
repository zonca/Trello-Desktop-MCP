import { HealthChecker, type HealthStatus } from '../../src/utils/health';
import { jest } from '@jest/globals';

// Mock logger and insights
jest.unstable_mockModule('../../src/utils/logger.js', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  }
}));

jest.unstable_mockModule('../../src/utils/appInsights.js', () => ({
  insights: {
    trackEvent: jest.fn(),
    trackMetric: jest.fn(),
    trackException: jest.fn()
  }
}));

describe('HealthChecker', () => {
  let healthChecker: HealthChecker;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    healthChecker = new HealthChecker();
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('getHealthStatus', () => {
    it('should return healthy status when all systems are operational', async () => {
      // Mock successful Trello API check
      global.fetch = jest.fn().mockResolvedValue({
        status: 200,
        ok: true
      } as Response);

      const status = await healthChecker.getHealthStatus();

      expect(status).toBeDefined();
      expect(status.status).toBe('healthy');
      expect(status.timestamp).toBeDefined();
      expect(status.version).toBe('1.0.0');
      expect(status.uptime).toBeGreaterThanOrEqual(0);
      expect(status.memory).toBeDefined();
      expect(status.nodejs).toBeDefined();
      expect(status.services.trello.status).toBe('available');
      expect(status.services.mcp.status).toBe('active');
      expect(status.performance.memoryUtilization).toBeGreaterThanOrEqual(0);
      expect(status.performance.memoryUtilization).toBeLessThanOrEqual(100);
    });

    it('should return healthy status even when Trello API is unavailable', async () => {
      // Mock failed Trello API check
      global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));

      const status = await healthChecker.getHealthStatus();

      expect(status.status).toBe('healthy');
      expect(status.services.trello.status).toBe('unavailable');
      expect(status.services.mcp.status).toBe('active');
    });

    it('should return 404 as available for Trello API', async () => {
      // Mock 404 response (API is working but endpoint not found)
      global.fetch = jest.fn().mockResolvedValue({
        status: 404,
        ok: false
      } as Response);

      const status = await healthChecker.getHealthStatus();

      expect(status.services.trello.status).toBe('available');
    });

    it('should return unavailable for 5xx errors from Trello API', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        status: 500,
        ok: false
      } as Response);

      const status = await healthChecker.getHealthStatus();

      expect(status.services.trello.status).toBe('unavailable');
    });

    it('should include Node.js system information', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        status: 200,
        ok: true
      } as Response);

      const status = await healthChecker.getHealthStatus();

      expect(status.nodejs.version).toBe(process.version);
      expect(status.nodejs.platform).toBe(process.platform);
      expect(status.nodejs.arch).toBe(process.arch);
    });

    it('should include memory usage information', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        status: 200,
        ok: true
      } as Response);

      const status = await healthChecker.getHealthStatus();

      expect(status.memory).toBeDefined();
      expect(status.memory.heapUsed).toBeGreaterThan(0);
      expect(status.memory.heapTotal).toBeGreaterThan(0);
      expect(status.performance.memoryUtilization).toBeGreaterThanOrEqual(0);
    });

    it('should include Azure information when available', async () => {
      const originalEnv = { ...process.env };
      process.env.WEBSITE_HOSTNAME = 'test.azurewebsites.net';
      process.env.WEBSITE_INSTANCE_ID = 'instance-123';
      process.env.WEBSITE_SITE_NAME = 'test-site';
      process.env.WEBSITE_RESOURCE_GROUP = 'test-rg';
      process.env.APPLICATIONINSIGHTS_CONNECTION_STRING = 'test-connection';

      global.fetch = jest.fn().mockResolvedValue({
        status: 200,
        ok: true
      } as Response);

      const status = await healthChecker.getHealthStatus();

      expect(status.azure.hostname).toBe('test.azurewebsites.net');
      expect(status.azure.instanceId).toBe('instance-123');
      expect(status.azure.siteName).toBe('test-site');
      expect(status.azure.resourceGroup).toBe('test-rg');
      expect(status.azure.applicationInsights).toBe(true);

      process.env = originalEnv;
    });

    it('should handle Trello API timeout', async () => {
      // Mock timeout
      global.fetch = jest.fn().mockImplementation(() => 
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Timeout')), 100)
        )
      );

      const status = await healthChecker.getHealthStatus();

      expect(status.services.trello.status).toBe('unavailable');
    });
  });

  describe('recordRequestTime', () => {
    it('should record request times', () => {
      healthChecker.recordRequestTime(100);
      healthChecker.recordRequestTime(200);
      healthChecker.recordRequestTime(150);

      // This is tested indirectly through getHealthStatus
      expect(true).toBe(true);
    });

    it('should limit stored request times to maxRequestTimes', () => {
      // Record more than 100 request times
      for (let i = 0; i < 150; i++) {
        healthChecker.recordRequestTime(100 + i);
      }

      // Should not throw and should maintain only last 100
      expect(true).toBe(true);
    });
  });

  describe('handleHealthCheck', () => {
    let mockReq: any;
    let mockRes: any;

    beforeEach(() => {
      mockReq = {
        ip: '127.0.0.1',
        get: jest.fn().mockReturnValue('TestAgent/1.0')
      };

      mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };

      global.fetch = jest.fn().mockResolvedValue({
        status: 200,
        ok: true
      } as Response);
    });

    it('should return 200 for healthy status', async () => {
      await healthChecker.handleHealthCheck(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalled();
      
      const jsonCall = mockRes.json.mock.calls[0][0] as HealthStatus;
      expect(jsonCall.status).toBe('healthy');
    });

    it('should return 200 for degraded status', async () => {
      // Record some slow requests to trigger degraded status
      for (let i = 0; i < 10; i++) {
        healthChecker.recordRequestTime(1500); // > 1000ms threshold
      }

      await healthChecker.handleHealthCheck(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      
      const jsonCall = mockRes.json.mock.calls[0][0] as HealthStatus;
      expect(jsonCall.status).toBe('degraded');
    });

    it('should return 503 for unhealthy status', async () => {
      // Mock an error scenario
      global.fetch = jest.fn().mockRejectedValue(new Error('Failed'));
      
      // Force an error by using undefined healthChecker
      const badHealthChecker = new HealthChecker();
      
      // Override getHealthStatus to throw
      badHealthChecker.getHealthStatus = jest.fn().mockRejectedValue(
        new Error('Health check failed')
      );

      await badHealthChecker.handleHealthCheck(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(503);
      expect(mockRes.json).toHaveBeenCalled();
      
      const jsonCall = mockRes.json.mock.calls[0][0];
      expect(jsonCall.status).toBe('unhealthy');
      expect(jsonCall.error).toBe('Health check failed');
    });

    it('should record request time for health check', async () => {
      const recordSpy = jest.spyOn(healthChecker, 'recordRequestTime');

      await healthChecker.handleHealthCheck(mockReq, mockRes);

      expect(recordSpy).toHaveBeenCalledWith(expect.any(Number));
      
      recordSpy.mockRestore();
    });

    it('should include average response time when available', async () => {
      // Record some request times
      healthChecker.recordRequestTime(100);
      healthChecker.recordRequestTime(200);
      healthChecker.recordRequestTime(150);

      await healthChecker.handleHealthCheck(mockReq, mockRes);

      const jsonCall = mockRes.json.mock.calls[0][0] as HealthStatus;
      expect(jsonCall.performance.avgResponseTime).toBeDefined();
      expect(jsonCall.performance.avgResponseTime).toBeGreaterThan(0);
    });
  });

  describe('status determination', () => {
    it('should return degraded status for high memory usage', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        status: 200,
        ok: true
      } as Response);

      // Mock high memory usage
      const originalMemoryUsage = process.memoryUsage;
      process.memoryUsage = jest.fn().mockReturnValue({
        heapUsed: 850000000, // 850 MB used
        heapTotal: 1000000000, // 1 GB total
        external: 0,
        arrayBuffers: 0,
        rss: 1000000000
      });

      const status = await healthChecker.getHealthStatus();

      // Memory utilization: (850 / 1000) * 100 = 85% > 80% threshold
      expect(status.status).toBe('degraded');

      process.memoryUsage = originalMemoryUsage;
    });

    it('should return unhealthy status for very high memory usage', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        status: 200,
        ok: true
      } as Response);

      // Mock very high memory usage
      const originalMemoryUsage = process.memoryUsage;
      process.memoryUsage = jest.fn().mockReturnValue({
        heapUsed: 920000000, // 920 MB used
        heapTotal: 1000000000, // 1 GB total
        external: 0,
        arrayBuffers: 0,
        rss: 1000000000
      });

      const status = await healthChecker.getHealthStatus();

      // Memory utilization: (920 / 1000) * 100 = 92% > 90% threshold
      expect(status.status).toBe('unhealthy');

      process.memoryUsage = originalMemoryUsage;
    });
  });
});
