/**
 * Restaurant Print Agent Module
 * ================================
 * Refactored from standalone agent into a class that Electron can import.
 * Handles: polling for jobs, claiming, ESC/POS printing, heartbeat, logging.
 */

const http = require('https');
const httpHttp = require('http');
const fs = require('fs');
const path = require('path');
const net = require('net');

const AGENT_VERSION = '1.0.0';

class PrintAgent {
  constructor(config, callbacks = {}) {
    this.config = config;
    this.callbacks = callbacks; // { onStatusChange, onPrintSuccess, onPrintError, onLog, onConnectionInfo }

    this.apiBase = (config.apiBaseUrl || '').replace(/\/$/, '');
    this.authHeader = `Bearer ${config.agentToken || ''}`;
    this.pollInterval = config.pollIntervalMs || 5000;
    this.heartbeatInterval = config.heartbeatIntervalMs || 30000;
    this.localPrinterIp = config.printerIp || '';
    this.localPrinterPort = config.printerPort || 9100;

    this.isProcessing = false;
    this.running = false;
    this.startTime = null;

    // Connection state
    this.connectionInfo = {
      server: 'checking',    // 'connected', 'disconnected', 'checking'
      printer: 'checking',   // 'connected', 'disconnected', 'checking', 'no-printers'
      location: null,        // location name from heartbeat
      printers: [],          // printer list from server
      lastServerCheck: null,
      lastPrinterCheck: null,
      serverError: null,
      printerError: null,
    };

    // Log buffer for server
    this.logBuffer = [];
    this.maxLogBuffer = 50;

    // Timers
    this._pollTimer = null;
    this._heartbeatTimer = null;
    this._logFlushTimer = null;
    this._printerCheckTimer = null;
  }

  // ============ LIFECYCLE ============

  start() {
    if (this.running) return;
    this.running = true;
    this.startTime = Date.now();

    this.log('INFO', `Restaurant Printer Agent v${AGENT_VERSION} starting...`);
    this.log('INFO', `Server: ${this.apiBase}`);
    this.log('INFO', `Poll: ${this.pollInterval}ms, Heartbeat: ${this.heartbeatInterval}ms`);

    this._emitStatus('online');

    // Initial heartbeat
    this.heartbeat();

    // Start intervals
    this._pollTimer = setInterval(() => this.claimAndPrint(), this.pollInterval);
    this._heartbeatTimer = setInterval(() => this.heartbeat(), this.heartbeatInterval);
    this._logFlushTimer = setInterval(() => this.flushLogs(), 60000);
    this._printerCheckTimer = setInterval(() => this.checkPrinters(), 60000);

    // Initial printer check (after short delay to let heartbeat finish first)
    setTimeout(() => this.checkPrinters(), 3000);

    this.log('INFO', 'Agent is running. Waiting for print jobs...');
  }

  stop() {
    this.running = false;
    clearInterval(this._pollTimer);
    clearInterval(this._heartbeatTimer);
    clearInterval(this._logFlushTimer);
    clearInterval(this._printerCheckTimer);
    this._pollTimer = null;
    this._heartbeatTimer = null;
    this._logFlushTimer = null;
    this._printerCheckTimer = null;

    this.log('INFO', 'Agent stopped.');
    this._emitStatus('offline');

    // Flush remaining logs
    this.flushLogs();
  }

  // ============ LOGGING ============

  log(level, message, metadata = {}) {
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] [${level}] ${message}`;

    // Console (for dev)
    console.log(line);

    // Buffer for server
    this.logBuffer.push({ level, message, metadata, timestamp });
    if (this.logBuffer.length > this.maxLogBuffer * 2) {
      this.logBuffer.splice(0, this.logBuffer.length - this.maxLogBuffer);
    }

    // Callback to UI
    if (this.callbacks.onLog) {
      this.callbacks.onLog(level, message);
    }
  }

  // ============ HTTP CLIENT ============

  apiRequest(method, urlPath, body = null) {
    const apiBase = this.apiBase;
    const authHeader = this.authHeader;

    return new Promise((resolve, reject) => {
      const url = new URL(apiBase + urlPath);
      const isHttps = url.protocol === 'https:';
      const lib = isHttps ? http : httpHttp;

      const options = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method,
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/json',
          'User-Agent': `RestaurantPrinterAgent/${AGENT_VERSION}`,
        },
        timeout: 15000,
      };

      const req = lib.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve(json);
            } else {
              reject(new Error(`HTTP ${res.statusCode}: ${json.error || data}`));
            }
          } catch (e) {
            reject(new Error(`Invalid JSON response: ${data.slice(0, 200)}`));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timed out'));
      });

      if (body) {
        req.write(JSON.stringify(body));
      }
      req.end();
    });
  }

  // ============ CLAIM & PRINT LOOP ============

  async claimAndPrint() {
    if (this.isProcessing || !this.running) return;
    this.isProcessing = true;

    try {
      const result = await this.apiRequest('POST', '/api/agent/claim');

      if (!result.data) {
        // No pending jobs — normal
        return;
      }

      const job = result.data;
      const order = job.orders;
      const printer = job.printers;

      // Override printer IP with local config if set
      if (this.localPrinterIp && printer) {
        printer.ip_address = this.localPrinterIp;
        printer.port = this.localPrinterPort;
      }

      this.log('INFO', `Claimed job ${job.id} for order #${order?.order_number} -> printer "${printer?.name}"`);

      try {
        await this.printTicket(printer, order);

        // Report success
        await this.apiRequest('PATCH', `/api/print-jobs/${job.id}`, {
          status: 'PRINTED',
        });

        this.log('INFO', `✅ Printed order #${order?.order_number} on "${printer?.name}"`);

        if (this.callbacks.onPrintSuccess) {
          this.callbacks.onPrintSuccess(order?.order_number, printer?.name);
        }
      } catch (printError) {
        this.log('ERROR', `❌ Print failed for order #${order?.order_number}: ${printError.message}`);

        if (this.callbacks.onPrintError) {
          this.callbacks.onPrintError(order?.order_number, printError.message);
        }

        // Report failure
        try {
          await this.apiRequest('PATCH', `/api/print-jobs/${job.id}`, {
            status: 'FAILED',
            error: printError.message,
          });
        } catch (reportError) {
          this.log('ERROR', `Failed to report print failure: ${reportError.message}`);
        }
      }
    } catch (error) {
      if (!error.message.includes('No pending')) {
        this.log('WARN', `Claim cycle error: ${error.message}`);

        // If we get repeated errors, go to error state
        if (this.callbacks.onStatusChange) {
          // Only signal error for actual connection problems, not empty queues
          if (error.message.includes('ECONNREFUSED') || error.message.includes('timed out')) {
            this._emitStatus('error');
          }
        }
      }
    } finally {
      this.isProcessing = false;
    }
  }

  // ============ HEARTBEAT ============

  async heartbeat() {
    if (!this.running) return;

    try {
      const result = await this.apiRequest('POST', '/api/agent/heartbeat', {
        printers: [],
        agentVersion: AGENT_VERSION,
        uptime: Math.floor((Date.now() - (this.startTime || Date.now())) / 1000),
      });

      // Heartbeat success means we're online
      this._emitStatus('online');
      this.connectionInfo.server = 'connected';
      this.connectionInfo.lastServerCheck = new Date().toISOString();
      this.connectionInfo.serverError = null;

      // Capture location name if returned
      if (result.locationName) {
        this.connectionInfo.location = result.locationName;
      }

      this._emitConnectionInfo();

      // Process commands
      if (result.commands && result.commands.length > 0) {
        for (const cmd of result.commands) {
          await this.handleCommand(cmd);
        }
      }

      if (result.pendingJobs > 0) {
        this.log('DEBUG', `${result.pendingJobs} pending print jobs in queue`);
      }
    } catch (error) {
      this.log('WARN', `Heartbeat failed: ${error.message}`);
      this._emitStatus('error');
      this.connectionInfo.server = 'disconnected';
      this.connectionInfo.serverError = error.message;
      this.connectionInfo.lastServerCheck = new Date().toISOString();
      this._emitConnectionInfo();
    }
  }

  // ============ COMMAND HANDLER ============

  async handleCommand(cmd) {
    this.log('INFO', `Received command: ${cmd.command}`);

    let status = 'COMPLETED';
    let result = {};

    try {
      switch (cmd.command) {
        case 'TEST_PRINT':
          if (cmd.payload && cmd.payload.printer) {
            await this.printTicket(cmd.payload.printer, {
              order_number: 'TEST-001',
              created_at: new Date().toISOString(),
              delivery_type: 'PICKUP',
              customer_name: 'TEST PRINT',
              customer_phone: '',
              subtotal: 0,
              delivery_fee: 0,
              service_fee: 0,
              total: 0,
              order_items: [{ name: 'Test pagina', quantity: 1, price: 0 }],
              notes: 'Dit is een testprint vanuit het admin panel.',
            });
            result = { message: 'Test print sent' };
          } else {
            status = 'FAILED';
            result = { error: 'No printer specified in payload' };
          }
          break;

        case 'UPDATE_CONFIG':
          result = { message: 'Config reload not applicable in Electron mode' };
          break;

        default:
          status = 'FAILED';
          result = { error: `Unknown command: ${cmd.command}` };
      }
    } catch (err) {
      status = 'FAILED';
      result = { error: err.message };
    }

    // Report command result
    try {
      await this.apiRequest('POST', '/api/agent/command-result', {
        commandId: cmd.id, status, result,
      });
    } catch (e) {
      this.log('ERROR', `Failed to report command result: ${e.message}`);
    }
  }

  // ============ TEST PRINT (local, from UI) ============

  async testPrint() {
    this.log('INFO', 'Test print requested from UI');
    try {
      const testOrder = {
        order_number: 'TEST-' + Date.now().toString().slice(-4),
        created_at: new Date().toISOString(),
        delivery_type: 'PICKUP',
        customer_name: 'TEST PRINT',
        customer_phone: '',
        subtotal: 12.50,
        delivery_fee: 0,
        service_fee: 0,
        total: 12.50,
        order_items: [
          { name: 'Test Item 1', quantity: 2, price: 5.00 },
          { name: 'Test Item 2', quantity: 1, price: 2.50 },
        ],
        notes: 'Dit is een testprint vanuit de Printer App.',
      };

      // Get printers for this location from the server
      let printers = [];
      try {
        const result = await this.apiRequest('GET', '/api/agent/printers');
        printers = (result.data || []).filter(p => p.ip_address);
      } catch (e) {
        this.log('WARN', `Could not fetch printers: ${e.message}`);
      }

      if (printers.length > 0 && printers[0].ip_address) {
        // Print to the first active real printer
        const printer = printers[0];
        // Override with local IP if configured
        if (this.localPrinterIp) {
          printer.ip_address = this.localPrinterIp;
          printer.port = this.localPrinterPort;
        }
        this.log('INFO', `Sending test print to ${printer.name} (${printer.ip_address}:${printer.port || 9100})`);
        await this.printTicket(printer, testOrder);

        if (this.callbacks.onPrintSuccess) {
          this.callbacks.onPrintSuccess(testOrder.order_number, printer.name);
        }
        this.log('INFO', `✅ Test print sent to ${printer.name}`);
      } else {
        // Fallback: console test print
        this.log('WARN', 'No printers found — printing to console instead');
        this.printTicketToConsole({ name: 'Console Test', ip_address: 'n/a' }, testOrder);

        if (this.callbacks.onPrintSuccess) {
          this.callbacks.onPrintSuccess(testOrder.order_number, 'Console (geen printer gevonden)');
        }
        this.log('INFO', '✅ Test print to console completed');
      }
    } catch (error) {
      this.log('ERROR', `Test print failed: ${error.message}`);
      if (this.callbacks.onPrintError) {
        this.callbacks.onPrintError('TEST', error.message);
      }
    }
  }

  // ============ ESC/POS PRINTING ============

  printTicket(printerInfo, orderData) {
    return new Promise((resolve, reject) => {
      const ip = printerInfo.ip_address;
      const port = printerInfo.port || 9100;
      const paperWidth = printerInfo.paper_width || 80;

      if (!ip) {
        return reject(new Error(`Printer ${printerInfo.name} has no IP address configured`));
      }

      const client = new net.Socket();
      const timeout = setTimeout(() => {
        client.destroy();
        reject(new Error(`Connection timeout to printer ${ip}:${port}`));
      }, 10000);

      client.connect(port, ip, () => {
        clearTimeout(timeout);
        try {
          const commands = this.buildEscPosTicket(orderData, paperWidth);
          client.write(Buffer.from(commands));

          setTimeout(() => {
            client.end();
            resolve();
          }, 500);
        } catch (err) {
          client.destroy();
          reject(err);
        }
      });

      client.on('error', (err) => {
        clearTimeout(timeout);
        reject(new Error(`Printer connection error: ${err.message}`));
      });
    });
  }

  buildEscPosTicket(order, paperWidth) {
    const ESC = '\x1B';
    const GS = '\x1D';
    const LF = '\x0A';

    const INIT = ESC + '@';
    const CENTER = ESC + 'a' + '\x01';
    const LEFT = ESC + 'a' + '\x00';
    const BOLD_ON = ESC + 'E' + '\x01';
    const BOLD_OFF = ESC + 'E' + '\x00';
    const DOUBLE_SIZE = GS + '!' + '\x11';
    const NORMAL_SIZE = GS + '!' + '\x00';
    const CUT = GS + 'V' + '\x00';
    const FEED3 = LF + LF + LF + LF + LF + LF;

    const charWidth = paperWidth === 58 ? 32 : 48;
    const LINE = '-'.repeat(charWidth);

    let ticket = '';
    ticket += INIT;

    // Header
    ticket += CENTER;
    ticket += DOUBLE_SIZE;
    ticket += BOLD_ON;
    ticket += order.restaurant_name || 'RESTAURANT' + LF;
    ticket += NORMAL_SIZE;
    ticket += BOLD_OFF;
    ticket += LINE + LF;

    // Order info
    ticket += BOLD_ON;
    ticket += `BESTELLING #${order.order_number}` + LF;
    ticket += BOLD_OFF;

    const date = new Date(order.created_at);
    ticket += date.toLocaleString('nl-NL', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    }) + LF;

    ticket += LINE + LF;

    // Delivery type
    ticket += BOLD_ON;
    ticket += DOUBLE_SIZE;
    if (order.delivery_type === 'DELIVERY') {
      ticket += '>> BEZORGEN <<' + LF;
    } else {
      ticket += '>> AFHALEN <<' + LF;
    }
    ticket += NORMAL_SIZE;
    ticket += BOLD_OFF;

    // Customer info
    ticket += LEFT;
    ticket += `Klant: ${order.customer_name}` + LF;
    if (order.customer_phone) {
      ticket += `Tel: ${order.customer_phone}` + LF;
    }

    if (order.delivery_type === 'DELIVERY') {
      ticket += `Adres: ${order.address_street || ''}` + LF;
      ticket += `       ${order.address_postcode || ''} ${order.address_city || ''}` + LF;
    }

    ticket += LINE + LF;

    // Items
    ticket += BOLD_ON;
    ticket += 'ITEMS:' + LF;
    ticket += BOLD_OFF;

    const items = order.order_items || [];
    for (const item of items) {
      const qty = item.quantity || 1;
      const name = item.name || 'Onbekend';
      const price = parseFloat(item.price || 0).toFixed(2);

      const itemLine = `${qty}x ${name}`;
      const priceStr = `EUR ${price}`;
      const pad = charWidth - itemLine.length - priceStr.length;

      if (pad > 0) {
        ticket += itemLine + ' '.repeat(pad) + priceStr + LF;
      } else {
        ticket += itemLine + LF;
        ticket += ' '.repeat(charWidth - priceStr.length) + priceStr + LF;
      }

      if (item.notes) {
        ticket += `  > ${item.notes}` + LF;
      }
    }

    ticket += LINE + LF;

    // Totals
    const subtotalStr = `EUR ${parseFloat(order.subtotal || 0).toFixed(2)}`;
    ticket += this._padLine('Subtotaal:', subtotalStr, charWidth) + LF;

    if (order.delivery_fee > 0) {
      const feeStr = `EUR ${parseFloat(order.delivery_fee).toFixed(2)}`;
      ticket += this._padLine('Bezorgkosten:', feeStr, charWidth) + LF;
    }
    if (order.service_fee > 0) {
      const svcStr = `EUR ${parseFloat(order.service_fee).toFixed(2)}`;
      ticket += this._padLine('Servicekosten:', svcStr, charWidth) + LF;
    }

    ticket += BOLD_ON;
    const totalStr = `EUR ${parseFloat(order.total || 0).toFixed(2)}`;
    ticket += this._padLine('TOTAAL:', totalStr, charWidth) + LF;
    ticket += BOLD_OFF;

    // Notes
    if (order.notes) {
      ticket += LINE + LF;
      ticket += BOLD_ON;
      ticket += 'OPMERKING:' + LF;
      ticket += BOLD_OFF;
      ticket += order.notes + LF;
    }

    ticket += LINE + LF;
    ticket += CENTER;
    ticket += 'Bedankt voor uw bestelling!' + LF;

    ticket += FEED3;
    ticket += CUT;

    return ticket;
  }

  // ============ CONSOLE TEST PRINT ============

  printTicketToConsole(printerInfo, orderData) {
    const W = 48;
    const LINE = '='.repeat(W);
    const DASH = '-'.repeat(W);
    const items = orderData.order_items || [];

    const lines = [];
    lines.push('');
    lines.push(LINE);
    lines.push(this._center(orderData.restaurant_name || 'RESTAURANT', W));
    lines.push(DASH);
    lines.push(this._center(`BESTELLING #${orderData.order_number}`, W));
    const date = new Date(orderData.created_at);
    lines.push(this._center(date.toLocaleString('nl-NL'), W));
    lines.push(DASH);
    const type = orderData.delivery_type === 'DELIVERY' ? '>> BEZORGEN <<' : '>> AFHALEN <<';
    lines.push(this._center(type, W));
    lines.push(`Klant: ${orderData.customer_name}`);
    if (orderData.customer_phone) lines.push(`Tel:   ${orderData.customer_phone}`);
    if (orderData.delivery_type === 'DELIVERY') {
      lines.push(`Adres: ${orderData.address_street || ''}`);
      lines.push(`       ${orderData.address_postcode || ''} ${orderData.address_city || ''}`);
    }
    lines.push(DASH);
    lines.push('ITEMS:');
    for (const item of items) {
      const left = `${item.quantity || 1}x ${item.name || 'Onbekend'}`;
      const right = `EUR ${parseFloat(item.price || 0).toFixed(2)}`;
      lines.push(this._padLine(left, right, W));
      if (item.notes) lines.push(`  > ${item.notes}`);
    }
    lines.push(DASH);
    lines.push(this._padLine('Subtotaal:', `EUR ${parseFloat(orderData.subtotal || 0).toFixed(2)}`, W));
    if (orderData.delivery_fee > 0)
      lines.push(this._padLine('Bezorgkosten:', `EUR ${parseFloat(orderData.delivery_fee).toFixed(2)}`, W));
    if (orderData.service_fee > 0)
      lines.push(this._padLine('Servicekosten:', `EUR ${parseFloat(orderData.service_fee).toFixed(2)}`, W));
    lines.push(this._padLine('TOTAAL:', `EUR ${parseFloat(orderData.total || 0).toFixed(2)}`, W));
    if (orderData.notes) {
      lines.push(DASH);
      lines.push('OPMERKING: ' + orderData.notes);
    }
    lines.push(LINE);
    lines.push(this._center('Bedankt voor uw bestelling!', W));
    lines.push(LINE);
    lines.push(`[TEST] Printer: ${printerInfo.name || 'onbekend'} (${printerInfo.ip_address || 'geen IP'})`);
    lines.push('');

    const output = lines.join('\n');
    console.log(output);
    this.log('INFO', `Test print output:\n${output}`);
  }

  // ============ FLUSH LOGS TO SERVER ============

  async flushLogs() {
    if (this.logBuffer.length === 0) return;

    const entries = this.logBuffer.splice(0, this.maxLogBuffer);
    try {
      await this.apiRequest('POST', '/api/agent/log', { entries });
    } catch (error) {
      // Put entries back on failure
      this.logBuffer.unshift(...entries);
      if (this.logBuffer.length > this.maxLogBuffer * 2) {
        this.logBuffer.splice(0, this.logBuffer.length - this.maxLogBuffer);
      }
    }
  }

  // ============ PRINTER CONNECTIVITY CHECK ============

  async checkPrinters() {
    try {
      const result = await this.apiRequest('GET', '/api/agent/printers');
      const printers = (result.data || []).filter(p => p.ip_address);

      // Override IP with local config if set
      if (this.localPrinterIp) {
        for (const printer of printers) {
          printer.ip_address = this.localPrinterIp;
          printer.port = this.localPrinterPort;
        }
      }

      this.connectionInfo.printers = printers;

      if (printers.length === 0) {
        this.connectionInfo.printer = 'no-printers';
        this.connectionInfo.printerError = 'Geen printers geconfigureerd op server';
        this._emitConnectionInfo();
        return;
      }

      // Check if at least one printer is reachable
      let anyReachable = false;
      for (const printer of printers) {
        const ok = await this.checkPrinterConnection(printer.ip_address, printer.port || 9100);
        printer._reachable = ok;
        if (ok) anyReachable = true;
      }

      this.connectionInfo.printer = anyReachable ? 'connected' : 'disconnected';
      this.connectionInfo.printerError = anyReachable ? null : 'Printer(s) niet bereikbaar op het netwerk';
      this.connectionInfo.lastPrinterCheck = new Date().toISOString();
      this._emitConnectionInfo();
    } catch (error) {
      this.log('WARN', `Printer check failed: ${error.message}`);
      this.connectionInfo.printerError = error.message;
      this._emitConnectionInfo();
    }
  }

  checkPrinterConnection(ip, port) {
    return new Promise((resolve) => {
      const client = new net.Socket();
      const timeout = setTimeout(() => {
        client.destroy();
        resolve(false);
      }, 3000);

      client.connect(port, ip, () => {
        clearTimeout(timeout);
        client.destroy();
        resolve(true);
      });

      client.on('error', () => {
        clearTimeout(timeout);
        client.destroy();
        resolve(false);
      });
    });
  }

  getConnectionInfo() {
    return { ...this.connectionInfo };
  }

  // ============ HELPERS ============

  _emitConnectionInfo() {
    if (this.callbacks.onConnectionInfo) {
      this.callbacks.onConnectionInfo({ ...this.connectionInfo });
    }
  }

  _emitStatus(status) {
    if (this.callbacks.onStatusChange) {
      this.callbacks.onStatusChange(status);
    }
  }

  _padLine(left, right, width) {
    const pad = width - left.length - right.length;
    if (pad > 0) {
      return left + ' '.repeat(pad) + right;
    }
    return left + ' ' + right;
  }

  _center(text, width) {
    const pad = Math.max(0, Math.floor((width - text.length) / 2));
    return ' '.repeat(pad) + text;
  }
}

module.exports = PrintAgent;
