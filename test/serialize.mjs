import { createSerializer } from 'bedrock-protocol/src/transforms/serializer.js'

const ser = createSerializer('1.26.40')

const variants = {
  'new-default': {
    needs_translation: false, category: 'message_only', type: 'chat',
    source_name: '', message: 'go', xuid: '', platform_chat_id: '',
    has_filtered_message: false, filtered_message: ''
  },
  'new-authored-xuid': {
    needs_translation: false, category: 'authored', type: 'chat',
    source_name: '', message: 'go', xuid: '2535428379150407', platform_chat_id: '',
    has_filtered_message: false, filtered_message: ''
  },
  'new-raw': {
    needs_translation: false, category: 'message_only', type: 'raw',
    message: 'go', xuid: '', platform_chat_id: '',
    has_filtered_message: false, filtered_message: ''
  },
  'new-translation': {
    needs_translation: true, category: 'parameters', type: 'translation',
    message: 'chat.type.text', parameters: ['go'], xuid: '', platform_chat_id: '',
    has_filtered_message: false, filtered_message: ''
  }
}

for (const [name, params] of Object.entries(variants)) {
  try {
    const buf = ser.createPacketBuffer({ name: 'text', params })
    console.log(name, 'len=' + buf.length, buf.toString('hex'))
  } catch (e) {
    console.log(name, 'ERROR', e.message)
  }
}
