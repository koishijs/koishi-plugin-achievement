import { App } from 'koishi'
import memory from '@koishijs/plugin-database-memory'
import mock from '@koishijs/plugin-mock'
import achv from '../src'

const app = new App()

app.plugin(mock)
app.plugin(memory)
app.plugin(achv)

app.achievements.register({
  id: '#1',
  name: '成就名-1',
  desc: '说明文本-1',
  category: 'foo',
  affinity: 10,
})

const client = app.mock.client('123')

before(async () => {
  await app.start()
  await app.mock.initUser('123', 3, { name: 'Satori' })
})

describe('@koishijs/plugin-achievement', () => {
  it('', async () => {
    await client.shouldReply('achv', [
      'Satori，您已获得 0/1 个成就，奖励好感度：0',
      'undefined (0/1)',
      '要查看特定的分类，请输入“achv 分类名”。',
    ].join('\n'))

    await client.shouldReply('achv 成就名-1', [
      '成就「成就名-1」（0%）',
      '说明文本-1',
    ].join('\n'))
  })
})
