import { Context, defineProperty, Dict, difference, makeArray, Query, Schema, Service, Session, union, User } from 'koishi'
import { adminUser } from '@koishijs/command-utils'

declare module 'koishi' {
  interface Session {
    achieve(id: string, hints: string[], achieve?: boolean | boolean[]): string
  }

  namespace Context {
    interface Services {
      achv: AchvService
    }
  }

  interface EventMap {
    'achievement/item'(achv: Achievement): void
    'achievement/category'(name: string): void
    'achievement/trigger'(session: Session, achv: Achievement, hints: string[]): void
  }

  interface User {
    achievement: string[]
  }
}

export const name = 'achievement'
export const using = ['database'] as const

export interface Config {
  filter?: Query.Expr<User>
}

export const Config = Schema.object({
})

const levelName = 'ⅠⅡⅢⅣⅤ'

interface Achievement<T extends User.Field = never> {
  id: string
  category: string
  name: string | string[]
  desc: string | string[]
  descHidden?: string
  affinity: number
  count?: number
  progress?: (user: Pick<User, T>) => number
  hidden?: true | ((user: Pick<User, T>) => boolean)
  parent?: Achievement
}

interface Category {
  name?: string
  data: Achievement[]
}

Session.prototype.achieve = function (this: Session<User.Field>, id, hints, achieve = true) {
  const { user, app } = this
  if (!achieve || user.achievement.includes(id)) return
  const achv = this.app.achv.data[id]
  const currentLevel = this.app.achv.getLevel(user, achv)
  if (typeof achv.desc === 'string') {
    if (currentLevel) return
    user.achievement.push(id)
  } else {
    const targetLevel = makeArray(achieve).reduce((prev, curr, index) => curr ? index + 1 : prev, 0)
    if (currentLevel >= targetLevel) return
    if (!currentLevel) {
      user.achievement.push(id += '-' + targetLevel)
    } else {
      const index = user.achievement.indexOf(`${id}-${currentLevel}`)
      user.achievement[index] = id += '-' + targetLevel
    }
  }

  hints.push(`恭喜 ${user.name} 获得了成就「${this.app.achv.data[id].name}」！`)
  app.emit('achievement/trigger', this, this.app.achv.data[id], hints)
  return hints.join('\n')
}

namespace Achievement {
  export interface Standalone extends Achievement {
    name: string
    desc: string
  }

  export interface Options {
    forced?: boolean
    achieved?: boolean
    unachieved?: boolean
  }
}

export default class AchvService extends Service {
  public theoretical = 0
  private catMap: Dict<Category> = {}
  private achvMap: Dict<Achievement> = {}
  private categories: Category[] & Dict<Category> = [] as any
  public data: Achievement[] & Dict<Achievement> = [] as any
  private fields = new Set<User.Field>(['achievement', 'name', 'flag'])

  constructor(ctx: Context, private config: Config) {
    super(ctx, 'achv', true)

    ctx.model.extend('user', {
      achievement: 'list',
    })

    ctx.command('adv/achievement [name]', '成就信息')
      .userFields(this.fields)
      .alias('achv')
      .shortcut('查看成就')
      .shortcut('我的成就')
      .shortcut('成就', { fuzzy: true })
      .option('achieved', '-a  显示已获得的成就')
      .option('unachieved', '-A  显示未获得的成就')
      .option('full', '-f  显示全部成就')
      .option('forced', '-F  强制查看', { authority: 4, hidden: true })
      .option('set', '-s  添加成就', { authority: 4 })
      .option('unset', '-S  删除成就', { authority: 4 })
      .use(adminUser)
      .action(async ({ session, options, next }, ...names) => {
        const user = session.user
        if (options.set || options.unset) {
          const { ids, notFound } = this.findAchievements(names)
          if (notFound.length) {
            return `未找到成就${notFound.map(name => `“${name}”`).join('，')}。`
          }
          if (options.unset) {
            user.achievement = difference(user.achievement, ids)
          } else {
            user.achievement = union(user.achievement, ids)
          }
          return
        }

        const [key] = names
        if (!key) return this.showCategories(user)

        if (key in this.catMap) {
          if (options.full) options.achieved = options.unachieved = true
          return options.forced
            ? this.showCategoryForced(this.catMap[key])
            : this.showCategory(user, this.catMap[key], options)
        }

        const { forced } = options
        const achv = this.achvMap[key]
        if (!achv) return next(`没有找到成就「${key}」。`)

        const { name, affinity, desc, hidden, descHidden } = achv
        const currentLevel = this.getLevel(user, achv)
        const isHidden = !currentLevel && (typeof hidden === 'function' ? hidden(user) : hidden)
        if (isHidden && !forced) {
          if (!options['pass']) return `没有找到成就「${key}」。`
          return next()
        }

        // 多级成就，每级名称不同
        if (typeof name !== 'string') {
          return name.map((name, index) => {
            const status = forced ? ''
              : currentLevel > index ? `（已获得 +${affinity}）`
                : index ? '（未获得）' : this.getProgress(user, achv)
            return `成就「${name}」${status}\n${desc[index]}`
          }).join('\n')
        }

        // 使用唯一的成就名
        const output = makeArray(desc).map((levelDesc, index) => {
          return (typeof desc === 'string' ? '' : levelName[index] + ' ')
            + (!forced && !currentLevel && descHidden ? descHidden : levelDesc)
            + (currentLevel > index ? `（+${affinity}）` : '')
        })
        output.unshift(`成就「${name}」`)
        if (!forced) {
          output[0] += currentLevel ? `（已获得）` : this.getProgress(user, achv)
        }
        return output.join('\n')
      })
  }

  async start() {
    if (!this.data.length) return
    const result: Dict<number> = {}
    await Promise.all(this.data.map((achv) => {
      return Promise.all(this.getChildren(achv).map(async ({ id }) => {
        result[id] = await this.ctx.database.eval(
          'user',
          { $count: 'id' },
          { $and: [{ achievement: { $el: id } }, this.config.filter] }
        )
      }))
    }))
    for (const key in result) {
      const achv = this.data[key]
      if (!achv.parent) {
        achv.count = result[key]
      } else {
        const { id } = achv.parent
        const level = +key.slice(id.length + 1)
        for (let i = level; i > 0; --i) {
          this.data[`${id}-${i}`].count += result[key]
        }
      }
    }
  }

  private findAchievements(names: string[]) {
    const notFound: string[] = [], ids: string[] = []
    for (const name of names) {
      if (this.achvMap[name]) {
        ids.push(this.achvMap[name].id)
      } else {
        notFound.push(name)
      }
    }
    return { ids, notFound }
  }

  public getLevel(user: Pick<User, 'achievement'>, { id, desc }: Achievement) {
    if (typeof desc === 'string') return +user.achievement.includes(id)
    const item = user.achievement.find(item => item.startsWith(id))
    return item ? +item.slice(id.length + 1) : 0
  }

  public getHidden(user: Pick<User, 'achievement'>, { hidden }: Achievement) {
    return typeof hidden === 'function' ? hidden(user) : hidden
  }

  public affinity(user: Pick<User, 'achievement'>, achvs: Achievement[] = this.data) {
    return achvs.reduce((prev, achv) => prev + this.getLevel(user, achv) * achv.affinity, 0)
  }

  private getCategory(id: string) {
    if (!this.categories[id]) {
      const cat: Category = { data: [] }
      this.categories.push(cat)
      defineProperty(this.categories, id, cat)
    }
    return this.categories[id]
  }

  private getChildren(achv: Achievement) {
    return typeof achv.desc === 'string'
      ? [achv as Achievement.Standalone]
      : achv.desc.map((_, i) => this.data[`${achv.id}-${i + 1}`] as Achievement.Standalone)
  }

  private checkHidden(user: Pick<User, 'achievement'>, name: string) {
    const achv = this.achvMap[name]
    return !this.getLevel(user, achv) && this.getHidden(user, achv)
  }

  public add<T extends User.Field = never>(achv: Achievement<T>, userFields: Iterable<T> = []) {
    this.data.push(achv)
    defineProperty(this.data, achv.id, achv)
    if (typeof achv.name === 'string') {
      this.ctx.emit('achievement/item', achv)
      this.achvMap[achv.name] = achv
    }
    if (typeof achv.desc === 'string') {
      this.theoretical += achv.affinity
    } else {
      achv.desc.forEach((desc, index) => {
        this.theoretical += achv.affinity
        const subAchv: Achievement.Standalone = Object.create(achv)
        subAchv.count = 0
        subAchv.desc = desc
        subAchv.parent = achv
        subAchv.id = `${achv.id}-${index + 1}`
        defineProperty(this.data, subAchv.id, subAchv)
        if (typeof achv.name === 'string') {
          subAchv.name = `${achv.name} ${levelName[index]}`
        } else {
          subAchv.name = achv.name[index]
          this.ctx.emit('achievement/item', subAchv)
          this.achvMap[subAchv.name] = achv
        }
      })
    }
    for (const field of userFields) {
      this.fields.add(field)
    }
    this.getCategory(achv.category).data.push(achv)
  }

  public category(id: string, ...names: string[]) {
    const category = this.getCategory(id)
    category.name = names[0]
    for (const name of names) {
      this.ctx.emit('achievement/category', name)
      this.catMap[name] = category
    }
  }

  private showCategories(user: User.Observed) {
    let total = 0
    const output = Object.values(this.categories).map(({ name, data }) => {
      const count = data.filter(achv => this.getLevel(user, achv)).length
      total += count
      return `${name} (${count}/${data.length})`
    })

    output.unshift(`${user.name}，您已获得 ${total}/${this.data.length} 个成就，奖励好感度：${this.affinity(user)}`)
    output.push('要查看特定的成就或分类，请输入“四季酱，成就 成就名/分类名”。')
    return output.join('\n')
  }

  private showCategoryForced({ name, data }: Category) {
    let theoretical = 0
    const output = data.map((achv) => {
      const children = this.getChildren(achv)
      theoretical += children.length * achv.affinity
      return typeof achv.name === 'string'
        ? `${achv.name} (${children.map(achv => `#${achv.count}`).join(' => ')})`
        : children.map(({ name, count }) => `${name} (#${count})`).join(' => ')
    })
    output.unshift(`「${name}」\n成就总数：${data.length}，理论好感度：${theoretical}`)
    output.push('要查看特定成就的取得条件，请输入“四季酱，成就 成就名”。')
    return output.join('\n')
  }

  private getProgress(user: User.Observed, achv: Achievement) {
    const { progress = () => 0 } = achv
    return `（${(progress(user) * 100).toFixed()}%）`
  }

  private showCategory(user: User.Observed, { name, data }: Category, options: Achievement.Options) {
    const { achieved, unachieved } = options
    let count = 0
    const output = data.map((achv) => {
      const level = this.getLevel(user, achv)
      if (level) count++
      if (achieved && !unachieved && !level) return
      if (!achieved && unachieved && level) return
      if (level) {
        const name = typeof achv.name !== 'string'
          ? this.getChildren(achv)[level - 1].name
          : achv.name
        return `${name}（已获得 +${level * achv.affinity}）`
      }

      const { name, hidden } = achv
      const isHidden = !level && (typeof hidden === 'function' ? hidden(user) : hidden)
      if (!achieved && !unachieved && isHidden) return
      return `${isHidden ? '？？？？' : makeArray(name)[level && level - 1]}${this.getProgress(user, achv)}`
    }).filter(Boolean)

    const bonus = this.affinity(user, data)
    output.unshift(`「${name}」\n${user.name}，您已达成 ${count}/${data.length} 个成就，奖励好感度：${bonus}`)
    output.push('要查看特定成就的取得条件，请输入“四季酱，成就 成就名”。')
    return output.join('\n')
  }
}
