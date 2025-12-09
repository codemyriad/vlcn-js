import { TransporOptions, Transport } from "./Transport";
import {
  AnnouncePresence,
  Changes,
  RejectChanges,
  StartStreaming,
  decode,
  encode,
  tags,
} from "@vlcn.io/ws-common";

export default class WebSocketTransport implements Transport {
  #socket: WebSocket | null = null;
  #hadStartStream = false;
  #closed = false;
  #options;
  #onReady: (() => void) | null = null;
  #keepAliveInterval: number | null = null;

  #closeTimeout: number | null = null;
  #pingTimeout: number | null = null;

  constructor(options: TransporOptions) {
    this.#options = options;
  }

  start(onReady: () => void) {
    this.#onReady = onReady;
    this.#socket = this.#openSocketAndKeepAlive(this.#options);
  }

  #openSocketAndKeepAlive(options: TransporOptions) {
    if (this.#closed) {
      return null;
    }

    if (this.#keepAliveInterval == null) {
      this.#keepAliveInterval = setInterval(
        () => {
          if (!this.#socket || this.#socket?.readyState === WebSocket.CLOSED) {
            this.#openSocketAndKeepAlive(options);
          }
        },
        Math.random() * 2000 + 1000
      );
    }

    const socket = new WebSocket(options.url, [
      btoa(
        `${options.authToken != null ? `auth=${options.authToken},` : ""}room=${
          options.room
        }`
      ).replaceAll("=", ""),
    ]);
    socket.binaryType = "arraybuffer";

    socket.addEventListener("message", (e: MessageEvent<ArrayBuffer>) => {
      this.#processEvent(new Uint8Array(e.data));
    });

    socket.onopen = () => {
      if (this.#onReady) this.#onReady();
      if (this.onConnOpen) this.onConnOpen();
      this.#resetSignOfLife();
    };

    socket.onclose = () => {
      if (this.onConnClose) this.onConnClose();
    };

    socket.onerror = () => {
      if (this.onConnClose) this.onConnClose();
    };

    this.#socket = socket;
    return socket;
  }

  #resetSignOfLife() {
    if (this.#closeTimeout) {
      clearTimeout(this.#closeTimeout);
    }
    if (this.#pingTimeout) {
      clearTimeout(this.#pingTimeout);
    }

    const { pingInterval = 1000, pingTimeout = 500 } = this.#options;

    this.#pingTimeout = setTimeout(() => {
      if (this.#socket && this.#socket.readyState === WebSocket.OPEN) {
        this.#socket.send(encode({ _tag: tags.Ping }));
      }
    }, pingInterval);

    this.#closeTimeout = setTimeout(() => {
      console.warn(
        "No sign of life from server, closing socket, the connection will retry until explicitly closed"
      );
      this.#closeSocket();
    }, pingInterval + pingTimeout);
  }

  // Works as a soft-close when connection drops:
  // - the socket gets closed and cleared
  // - internal this.#closed is still false -- keep retrying the connection
  // - run #openSocketAndKeepaAlive (reseting the keep alive interval if not set + retrying the connection)
  #closeSocket() {
    this.#socket?.close();
    this.#socket = null;
    this.#openSocketAndKeepAlive(this.#options);
  }

  onChangesReceived: ((msg: Changes) => Promise<void>) | null = null;
  onStartStreaming: ((msg: StartStreaming) => Promise<void>) | null = null;
  onResetStream: ((msg: StartStreaming) => Promise<void>) | null = null;
  onReconnected: (() => Promise<void>) | null = null;

  // Connection event callbacks
  onConnOpen: (() => void) | null = null;
  onConnClose: (() => void) | null = null;

  #processEvent = (data: Uint8Array) => {
    const msg = decode(data);

    // Any message from server is a sign of life
    this.#resetSignOfLife();

    switch (msg._tag) {
      case tags.AnnouncePresence:
      case tags.RejectChanges:
        // clients should not receive these evnts
        throw new Error(`Unexpected event: ${msg._tag}`);
      case tags.Changes:
        if (this.onChangesReceived) {
          this.onChangesReceived(msg);
        }
        return;
      case tags.StartStreaming:
        if (this.#hadStartStream) {
          this.onResetStream && this.onResetStream(msg);
        } else {
          this.#hadStartStream = true;
          this.onStartStreaming && this.onStartStreaming(msg);
        }
        return;
      case tags.Pong:
        // Right now pong is just a sign of life - handled above
        // TODO: we might implement additional data with the pong / heartbeat in the future
        return;
    }
  };

  announcePresence(msg: AnnouncePresence): void {
    this.#socket!.send(encode(msg));
  }

  sendChanges(msg: Changes): "reconnecting" | "buffer-full" | "sent" {
    if (this.#socket!.readyState !== WebSocket.OPEN) {
      return "reconnecting";
    }
    // If we do the below we need to nofiy the caller to back off on sending.
    if (this.#socket!.bufferedAmount > 1024 * 1024 * 5) {
      console.warn(
        "socket buffer full. Waiting till buffer is drained before allowing more changes to be queue for send."
      );
      return "buffer-full";
    }
    this.#socket!.send(encode(msg));
    return "sent";
  }

  rejectChanges(msg: RejectChanges): void {
    this.#socket!.send(encode(msg));
  }

  close() {
    this.#closed = true;
    this.#socket!.close();
    if (this.#keepAliveInterval) {
      clearInterval(this.#keepAliveInterval);
    }
  }
}
