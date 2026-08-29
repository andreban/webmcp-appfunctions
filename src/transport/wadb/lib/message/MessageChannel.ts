/*
 * Copyright 2020 Google Inc. All Rights Reserved.
 *
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 */

import {Transport} from '../transport';
import {Message} from './Message';
import {MessageHeader} from './MessageHeader';
import {Options} from '../Options';
import {MessageListener} from './MessageListener';

export class MessageChannel {
  private active = true;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(
      readonly transport: Transport,
      readonly options: Options,
      readonly listener: MessageListener) {
    void this.readLoop();
  }

  private async readLoop(): Promise<void> {
    try {
      while (this.active) {
        const message = await this.read();
        if (this.options.debug) {
          console.log('<<<', message);
        }
        this.listener.newMessage(message);
      }
    } catch (err) {
      if (this.active) {
        if (this.options.debug) {
          console.debug('MessageChannel readLoop ended:', err);
        }
        this.active = false;
      }
    }
  }

  private async readHeader(): Promise<MessageHeader> {
    const response = await this.transport.read(24);
    return MessageHeader.parse(response, this.options.useChecksum);
  }

  private async read(): Promise<Message> {
    const header = await this.readHeader();
    let receivedData;
    switch (header.cmd) {
      default: {
        if (header.length > 0) {
          receivedData = await this.transport.read(header.length);
        }
      }
    }
    const message = new Message(header, receivedData);
    return message;
  }

  close(): void {
    this.active = false;
  }

  async write(m: Message): Promise<void> {
    if (this.options.debug) {
      console.log('>>>', m);
    }

    // Combine header and payload into a single contiguous ArrayBuffer for atomic WebUSB transfer
    const headerView = m.header.toDataView();
    let payload: ArrayBuffer;

    if (m.data && m.data.byteLength > 0) {
      const combined = new Uint8Array(24 + m.data.byteLength);
      combined.set(
        new Uint8Array(headerView.buffer, headerView.byteOffset, headerView.byteLength),
        0
      );
      combined.set(
        new Uint8Array(m.data.buffer, m.data.byteOffset, m.data.byteLength),
        24
      );
      payload = combined.buffer as ArrayBuffer;
    } else {
      const single = new Uint8Array(headerView.byteLength);
      single.set(
        new Uint8Array(headerView.buffer, headerView.byteOffset, headerView.byteLength),
        0
      );
      payload = single.buffer as ArrayBuffer;
    }

    // Serialize writes through a promise queue to prevent concurrent transferOut operations
    const currentWrite = this.writeQueue
      .catch(() => {})
      .then(async () => {
        if (!this.active) {
          return;
        }
        await this.transport.write(payload);
      });

    this.writeQueue = currentWrite;
    return currentWrite;
  }
}
