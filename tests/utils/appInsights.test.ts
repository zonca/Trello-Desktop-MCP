import { insights } from '../../src/utils/appInsights';
import { jest } from '@jest/globals';

describe('ApplicationInsights', () => {
  let originalEnv: NodeJS.ProcessEnv;
  let consoleWarnSpy: jest.SpyInstance;
  let consoleLogSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    originalEnv = { ...process.env };
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = originalEnv;
    consoleWarnSpy.mockRestore();
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe('initialization', () => {
    it('should handle missing Application Insights configuration', () => {
      delete process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;
      delete process.env.APPINSIGHTS_INSTRUMENTATIONKEY;
      
      insights.initialize();
      
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'Application Insights not configured - telemetry disabled'
      );
    });

    it('should handle initialization with connection string', () => {
      process.env.APPLICATIONINSIGHTS_CONNECTION_STRING = 'test-connection-string';
      
      insights.initialize();
      
      // Should attempt to initialize (may fail if module not available)
      expect(consoleWarnSpy).toHaveBeenCalled();
    });

    it('should handle initialization with instrumentation key', () => {
      process.env.APPINSIGHTS_INSTRUMENTATIONKEY = 'test-instrumentation-key';
      
      insights.initialize();
      
      // Should attempt to initialize (may fail if module not available)
      expect(consoleWarnSpy).toHaveBeenCalled();
    });
  });

  describe('telemetry methods', () => {
    beforeEach(() => {
      delete process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;
      delete process.env.APPINSIGHTS_INSTRUMENTATIONKEY;
      insights.initialize();
    });

    it('should handle trackEvent when disabled', () => {
      expect(() => {
        insights.trackEvent('TestEvent', { prop: 'value' });
      }).not.toThrow();
    });

    it('should handle trackRequest when disabled', () => {
      expect(() => {
        insights.trackRequest('TestRequest', '/api/test', 100, 200, true);
      }).not.toThrow();
    });

    it('should handle trackDependency when disabled', () => {
      expect(() => {
        insights.trackDependency('HTTP', 'TestDep', 'test-data', 50, true);
      }).not.toThrow();
    });

    it('should handle trackException when disabled', () => {
      const error = new Error('Test error');
      expect(() => {
        insights.trackException(error);
      }).not.toThrow();
    });

    it('should not log exception when disabled', () => {
      const originalNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';
      
      const error = new Error('Test error');
      insights.trackException(error, { context: 'test' });
      
      // Since Application Insights is disabled in tests, it should not log
      // The actual logging only happens when isEnabled is true
      expect(consoleErrorSpy).not.toHaveBeenCalled();
      
      process.env.NODE_ENV = originalNodeEnv;
    });

    it('should not log exception in production mode', () => {
      const originalNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      
      const error = new Error('Test error');
      insights.trackException(error);
      
      expect(consoleErrorSpy).not.toHaveBeenCalled();
      
      process.env.NODE_ENV = originalNodeEnv;
    });

    it('should handle trackMetric when disabled', () => {
      expect(() => {
        insights.trackMetric('TestMetric', 42);
      }).not.toThrow();
    });

    it('should handle trackTrace when disabled', () => {
      expect(() => {
        insights.trackTrace('Test trace message');
      }).not.toThrow();
    });

    it('should handle flush when disabled', () => {
      expect(() => {
        insights.flush();
      }).not.toThrow();
    });
  });

  describe('telemetry with properties', () => {
    beforeEach(() => {
      delete process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;
      insights.initialize();
    });

    it('should accept properties in trackEvent', () => {
      expect(() => {
        insights.trackEvent('TestEvent', { 
          userId: '123',
          action: 'click'
        }, {
          duration: 100
        });
      }).not.toThrow();
    });

    it('should accept properties in trackRequest', () => {
      expect(() => {
        insights.trackRequest(
          'TestRequest',
          '/api/test',
          100,
          200,
          true,
          { customProp: 'value' }
        );
      }).not.toThrow();
    });

    it('should accept properties in trackDependency', () => {
      expect(() => {
        insights.trackDependency(
          'HTTP',
          'TestDep',
          'test-data',
          50,
          true,
          '200',
          { customProp: 'value' }
        );
      }).not.toThrow();
    });

    it('should accept properties in trackException', () => {
      expect(() => {
        insights.trackException(
          new Error('Test error'),
          { operation: 'test', userId: '123' }
        );
      }).not.toThrow();
    });

    it('should accept properties in trackMetric', () => {
      expect(() => {
        insights.trackMetric('TestMetric', 42, { tag: 'test' });
      }).not.toThrow();
    });

    it('should accept properties in trackTrace', () => {
      expect(() => {
        insights.trackTrace('Test message', 1, { context: 'test' });
      }).not.toThrow();
    });
  });
});
